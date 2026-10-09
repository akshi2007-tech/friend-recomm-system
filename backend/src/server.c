#include "app.h"
#include "server.h"
#include "json.h"
#include "bfs.h"
#include "trie.h"
#include "sort.h"
#include "persistence.h"
#include "requests.h"
#include "stats.h"
#include "unionfind.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET fg_socket;
#define FG_CLOSE closesocket
#define FG_BAD_SOCKET INVALID_SOCKET
typedef int (WSAAPI *FgWsaStartup)(WORD,LPWSADATA);
typedef SOCKET (WSAAPI *FgSocket)(int,int,int);
typedef int (WSAAPI *FgSetSockOpt)(SOCKET,int,int,const char*,int);
typedef u_short (WSAAPI *FgHtons)(u_short);
typedef u_long (WSAAPI *FgHtonl)(u_long);
typedef int (WSAAPI *FgBind)(SOCKET,const struct sockaddr*,int);
typedef int (WSAAPI *FgListen)(SOCKET,int);
typedef SOCKET (WSAAPI *FgAccept)(SOCKET,struct sockaddr*,int*);
typedef int (WSAAPI *FgRecv)(SOCKET,char*,int,int);
typedef int (WSAAPI *FgSend)(SOCKET,const char*,int,int);
typedef int (WSAAPI *FgCloseSocket)(SOCKET);
static FgWsaStartup fg_wsa_startup;static FgSocket fg_socket_call;static FgSetSockOpt fg_setsockopt;static FgHtons fg_htons;static FgHtonl fg_htonl;static FgBind fg_bind;static FgListen fg_listen;static FgAccept fg_accept;static FgRecv fg_recv;static FgSend fg_send;static FgCloseSocket fg_closesocket;
#define WSAStartup fg_wsa_startup
#define socket fg_socket_call
#define setsockopt fg_setsockopt
#define htons fg_htons
#define htonl fg_htonl
#define bind fg_bind
#define listen fg_listen
#define accept fg_accept
#define recv fg_recv
#define send fg_send
#define closesocket fg_closesocket
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
typedef int fg_socket;
#define FG_CLOSE close
#define FG_BAD_SOCKET (-1)
#endif

/* O(length), microsecond monotonic-ish clock for API diagnostics */
static unsigned long long ticks_us(void){return (unsigned long long)((double)clock()*1000000.0/CLOCKS_PER_SEC);}

/* O(request length) */
static const char*param(const char*src,const char*key,char*out,size_t cap){static char needle[96],jsonkey[96];snprintf(needle,sizeof needle,"%s=",key);const char*p=strstr(src,needle);int json=0;if(!p){snprintf(jsonkey,sizeof jsonkey,"\"%s\"",key);p=strstr(src,jsonkey);if(!p)return NULL;p+=strlen(jsonkey);while(*p&&(*p==' '||*p=='\t'))p++;if(*p!=':')return NULL;p++;while(*p&&(*p==' '||*p=='\t'))p++;json=1;if(*p=='\"')p++;}else p+=strlen(needle);size_t n=0;while(p[n]&&p[n]!='&'&&p[n]!=' '&&p[n]!='\r'&&p[n]!='\n'&&p[n]!='}'&&(!json||p[n]!='\"')&&n+1<cap)n++;memcpy(out,p,n);out[n]=0;return out;}

/* O(request length) */
static int param_int(const char*s,const char*k,int d){char b[32];return param(s,k,b,sizeof b)?atoi(b):d;}

static int find_content_length(const char* req) {
    const char* p = req;
    while (*p) {
        if ((p[0] == 'C' || p[0] == 'c') &&
            (p[1] == 'O' || p[1] == 'o') &&
            (p[2] == 'N' || p[2] == 'n') &&
            (p[3] == 'T' || p[3] == 't') &&
            (p[4] == 'E' || p[4] == 'e') &&
            (p[5] == 'N' || p[5] == 'n') &&
            (p[6] == 'T' || p[6] == 't') &&
            p[7] == '-' &&
            (p[8] == 'L' || p[8] == 'l') &&
            (p[9] == 'E' || p[9] == 'e') &&
            (p[10] == 'N' || p[10] == 'n') &&
            (p[11] == 'G' || p[11] == 'g') &&
            (p[12] == 'T' || p[12] == 't') &&
            (p[13] == 'H' || p[13] == 'h') &&
            p[14] == ':') {
            p += 15;
            while (*p == ' ' || *p == '\t') p++;
            return atoi(p);
        }
        p++;
    }
    return 0;
}

static int str_contains_case(const char* haystack, const char* needle) {
    if (!needle || !*needle) return 1;
    size_t hlen = strlen(haystack), nlen = strlen(needle);
    if (nlen > hlen) return 0;
    for (size_t i = 0; i <= hlen - nlen; i++) {
        size_t j = 0;
        while (j < nlen) {
            char c1 = haystack[i + j];
            char c2 = needle[j];
            if (c1 >= 'A' && c1 <= 'Z') c1 += 32;
            if (c2 >= 'A' && c2 <= 'Z') c2 += 32;
            if (c1 != c2) break;
            j++;
        }
        if (j == nlen) return 1;
    }
    return 0;
}

static int get_user_id_from_str(const char* val) {
    if (!val || !*val) return -1;
    int id = -1;
    if (ht_get(&fg_names, val, &id)) return id;
    int all_digits = 1;
    for (const char* p = val; *p; p++) {
        if (*p < '0' || *p > '9') { all_digits = 0; break; }
    }
    if (all_digits) {
        id = atoi(val);
        if (id >= 0 && (size_t)id < fg_user_count) return id;
    }
    return -1;
}

/* O(1) */
static int emit_user(JsonBuf*b,int id){if(id<0||(size_t)id>=fg_user_count)return 0;jb_printf(b,"{\"id\":%d,\"name\":",id);jb_quote(b,fg_users[id].name);jb_add(b,",\"handle\":");jb_quote(b,fg_users[id].handle);jb_add(b,",\"interests\":[");for(int i=0;i<fg_users[id].interest_count;i++){if(i)jb_char(b,',');jb_quote(b,fg_users[id].interests[i]);}jb_add(b,"]}");return 1;}

/* O(V+E+K*F), where F is average degree */
static void emit_recommendations(JsonBuf*b,int uid,int limit,int depth,int minimum){Recommendation r[128];size_t n=recommend_for_user(&fg_graph,fg_users,fg_user_count,uid,depth,minimum,limit,r);jb_add(b,"{\"recommendations\":[");for(size_t i=0;i<n;i++){if(i)jb_char(b,',');Recommendation*x=&r[i];jb_printf(b,"{\"id\":%d,\"name\":",x->id);jb_quote(b,fg_users[x->id].name);jb_add(b,",\"handle\":");jb_quote(b,fg_users[x->id].handle);jb_printf(b,",\"mutual_count\":%d,\"mutual_friends\":[",x->mutual_count);for(int j=0;j<x->mutual_count&&j<128;j++){if(j)jb_char(b,',');jb_quote(b,fg_users[x->mutual_ids[j]].name);}jb_printf(b,"],\"score\":%d,\"distance\":%d,\"path\":[",x->score,x->distance);for(int j=0;j<x->path_len;j++){if(j)jb_char(b,',');jb_quote(b,fg_users[x->path[j]].name);}jb_printf(b,"],\"score_breakdown\":{\"mutual_points\":%d,\"distance_points\":%d,\"interest_points\":%d,\"penalty\":%d}}",x->mutual_points,x->distance_points,x->interest_points,x->penalty);}jb_add(b,"]}");}

/* O(V+E) */
static void route_api(const char*method,const char*path,const char*body,JsonBuf*b,int*status){
 char q[512]; unsigned long long start=ticks_us(); *status=200;

 char user_param[96] = "";
 int user_param_specified = 0;
 if (param(path, "user", user_param, sizeof user_param) ||
     param(body, "user", user_param, sizeof user_param)) {
     user_param_specified = 1;
 }

 int uid = -1;
 if (user_param_specified) {
     uid = get_user_id_from_str(user_param);
     if (uid < 0) {
         *status = 404;
         jb_printf(b, "{\"error\":\"Unknown user\",\"engine_us\":%llu}", ticks_us() - start);
         return;
     }
 } else {
     uid = (fg_current_user >= 0 && (size_t)fg_current_user < fg_user_count) ? fg_current_user : 0;
 }

 if(strstr(path,"/api/health")){
  size_t total_edges = 0;
  for(size_t i = 0; i < fg_user_count; i++) total_edges += fg_graph.adj[i].len;
  jb_printf(b,"{\"ok\":true,\"users\":%lu,\"edges\":%lu,\"engine\":\"C11\",\"engine_us\":%llu}",(unsigned long)fg_user_count,(unsigned long)(total_edges/2),ticks_us()-start);
 }

 else if(!strcmp(path,"/api/users")){jb_add(b,"{\"users\":[");for(size_t i=0;i<fg_user_count;i++){if(i)jb_char(b,',');emit_user(b,(int)i);}jb_printf(b,"],\"engine_us\":%llu}",ticks_us()-start);}
 else if(!strcmp(path,"/api/login")&&!strcmp(method,"POST")){int id=0;char h[96];if(param(body,"username",h,sizeof h)&&ht_get(&fg_names,h,&id)){fg_current_user=id;emit_user(b,id);if(b->len&&b->data[b->len-1]=='}'){b->data[--b->len]=0;jb_printf(b,",\"engine_us\":%llu}",ticks_us()-start);}}else{*status=401;jb_printf(b,"{\"error\":\"Unknown username\",\"engine_us\":%llu}",ticks_us()-start);}}
 else if(strstr(path,"/api/recommendations")){
  int lim=param_int(path,"limit",12),dep=param_int(path,"maxDistance",3),minimum=param_int(path,"minMutual",0);
  emit_recommendations(b,uid,lim,dep,minimum);
  if(b->len>0&&b->data[b->len-1]=='}') b->data[--b->len] = '\0';
  jb_printf(b,",\"engine_us\":%llu}",ticks_us()-start);
 }
 else if(strstr(path,"/api/dashboard")){int friends=(int)fg_graph.adj[uid].len,pending=0,mutual=0;for(size_t i=0;i<fg_request_count;i++)if(fg_requests[i].status==0&&(fg_requests[i].to==uid||fg_requests[i].from==uid))pending++;for(size_t i=0;i<fg_graph.adj[uid].len;i++)for(size_t j=i+1;j<fg_graph.adj[uid].len;j++)if(are_friends(&fg_graph,fg_graph.adj[uid].items[i],fg_graph.adj[uid].items[j]))mutual++;Recommendation tmp[128];int rec_count=(int)recommend_for_user(&fg_graph,fg_users,fg_user_count,uid,3,0,128,tmp);jb_printf(b,"{\"friends\":%d,\"mutual_connections\":%d,\"pending_requests\":%d,\"recommended_users\":%d,\"user\":",friends,mutual,pending,rec_count);emit_user(b,uid);jb_add(b,",\"top_recommendations\":");JsonBuf temp;jb_init(&temp);emit_recommendations(&temp,uid,3,3,0);const char*arr=strstr(temp.data,"[");const char*end=strrchr(temp.data,']');if(arr&&end){jb_add(b,"[");if(end>arr+1){for(const char*p=arr+1;p<end;p++)jb_char(b,*p);}jb_char(b,']');}else jb_add(b,"[]");jb_free(&temp);jb_printf(b,",\"engine_us\":%llu}",ticks_us()-start);}
 else if(strstr(path,"/api/network")){BFSResult r;if(bfs_run(&fg_graph,uid,2,&r)){jb_add(b,"{\"nodes\":[");int first=1;for(size_t i=0;i<fg_user_count;i++)if(r.dist[i]>=0&&r.dist[i]<=2){if(!first)jb_char(b,',');first=0;jb_printf(b,"{\"id\":%zu,\"name\":",i);jb_quote(b,fg_users[i].name);jb_printf(b,",\"distance\":%d}",r.dist[i]);}jb_add(b,"],\"edges\":[");first=1;for(size_t i=0;i<fg_user_count;i++)for(size_t j=0;j<fg_graph.adj[i].len;j++){int v=fg_graph.adj[i].items[j];if(v>(int)i&&r.dist[i]>=0&&r.dist[v]>=0&&r.dist[i]<=2&&r.dist[v]<=2){if(!first)jb_char(b,',');first=0;jb_printf(b,"[%zu,%d]",i,v);}}jb_add(b,"],\"friends\":[");for(size_t i=0;i<fg_graph.adj[uid].len;i++){if(i)jb_char(b,',');emit_user(b,fg_graph.adj[uid].items[i]);}jb_printf(b,"],\"engine_us\":%llu}",ticks_us()-start);bfs_free(&r);}else{*status=500;jb_printf(b,"{\"error\":\"BFS failed\",\"engine_us\":%llu}",ticks_us()-start);}}
 else if(strstr(path,"/api/requests")&&!strstr(path,"/api/requests/send")&&!strstr(path,"/api/requests/respond")){jb_add(b,"{\"incoming\":[");int first=1;for(size_t i=0;i<fg_request_count;i++)if(fg_requests[i].to==uid&&fg_requests[i].status==0){if(!first)jb_char(b,',');first=0;jb_printf(b,"{\"id\":%d,\"from\":",fg_requests[i].id);emit_user(b,fg_requests[i].from);jb_char(b,'}');}jb_add(b,"],\"outgoing\":[");first=1;for(size_t i=0;i<fg_request_count;i++)if(fg_requests[i].from==uid&&fg_requests[i].status==0){if(!first)jb_char(b,',');first=0;jb_printf(b,"{\"id\":%d,\"to\":",fg_requests[i].id);emit_user(b,fg_requests[i].to);jb_char(b,'}');}jb_printf(b,"],\"engine_us\":%llu}",ticks_us()-start);}
 else if(strstr(path,"/api/search")){
  char prefix[128]=""; param(path,"q",prefix,sizeof prefix);
  int lim = param_int(path, "limit", 10);
  if (lim <= 0) lim = 10;
  char q_lower[128]="";
  size_t qlen = strlen(prefix);
  for(size_t i=0; i<qlen && i<sizeof(q_lower)-1; i++){
      char c = prefix[i];
      if(c>='A' && c<='Z') c += 32;
      q_lower[i] = c;
  }
  q_lower[qlen] = '\0';

  Trie t; trie_init(&t);
  for(size_t i=0;i<fg_user_count;i++) {
      char h_lower[FG_HANDLE];
      snprintf(h_lower, sizeof h_lower, "%s", fg_users[i].handle);
      for(char *p=h_lower; *p; p++) if(*p>='A' && *p<='Z') *p += 32;
      trie_insert(&t, h_lower);
  }
  int trie_found = q_lower[0] ? trie_has_prefix(&t, q_lower) : 1;

  jb_add(b,"{\"suggestions\":[");
  int first=1;
  int count=0;
  for(size_t i=0; i<fg_user_count && count < lim; i++){
      int is_match = 0;
      if (q_lower[0] == '\0') {
          is_match = 1;
      } else {
          char h_lower[FG_HANDLE];
          snprintf(h_lower, sizeof h_lower, "%s", fg_users[i].handle);
          for(char *p=h_lower; *p; p++) if(*p>='A' && *p<='Z') *p += 32;
          if (trie_found && !strncmp(h_lower, q_lower, strlen(q_lower))) {
              is_match = 1;
          } else if (str_contains_case(fg_users[i].handle, prefix) || str_contains_case(fg_users[i].name, prefix)) {
              is_match = 1;
          }
      }
      if (is_match) {
          if (!first) jb_char(b, ',');
          first = 0;
          emit_user(b, (int)i);
          count++;
      }
  }
  jb_printf(b,"],\"lookup_us\":%llu,\"engine_us\":%llu}",ticks_us()-start,ticks_us()-start);
  trie_free(&t);
 }
 else if(strstr(path,"/api/path")||strstr(path,"/api/visualize")){char target[128];int id=-1;if(param(path,"target",target,sizeof target))ht_get(&fg_names,target,&id);BFSResult r;if(id<0||!bfs_run(&fg_graph,uid,-1,&r)){*status=404;jb_printf(b,"{\"error\":\"Target or path not found\",\"engine_us\":%llu}",ticks_us()-start);}else{jb_add(b,"{\"distance\":");if(r.dist[id]<0)jb_add(b,"null");else jb_printf(b,"%d",r.dist[id]);jb_add(b,",\"path\":[");int pathids[128],n=0,v=id;while(v>=0&&n<128){pathids[n++]=v;if(v==uid)break;v=r.parent[v];}for(int i=n-1;i>=0;i--){if(i!=n-1)jb_char(b,',');jb_quote(b,fg_users[pathids[i]].name);}jb_add(b,"]");if(strstr(path,"/api/visualize")){jb_add(b,",\"trace\":[");for(int i=0;i<r.trace_len;i++){if(i)jb_char(b,',');BFSStep*s=&r.trace[i];jb_add(b,"{\"current\":");jb_quote(b,fg_users[s->current].name);jb_add(b,",\"queue\":[");for(int j=0;j<s->queue_len;j++){if(j)jb_char(b,',');jb_quote(b,fg_users[s->queue[j]].name);}jb_add(b,"],\"visited\":[");for(int j=0;j<s->visited_len;j++){if(j)jb_char(b,',');jb_quote(b,fg_users[s->visited[j]].name);}jb_add(b,"]}");}jb_add(b,"]");}jb_printf(b,",\"engine_us\":%llu}",ticks_us()-start);bfs_free(&r);}}
 else if(strstr(path,"/api/stats")){size_t edges=0;unsigned long long mt=0,qt=0;for(size_t i=0;i<fg_user_count;i++)edges+=fg_graph.adj[i].len;stats_sort_times(&fg_graph,&mt,&qt);jb_printf(b,"{\"V\":%zu,\"E\":%zu,\"avg_degree\":%.2f,\"hash_load_factor\":%.3f,\"hash_collisions\":%zu,\"max_chain\":%zu,\"bfs_us\":%llu,\"merge_sort_us\":%llu,\"quick_sort_us\":%llu,\"structures\":[\"adjacency list\",\"hash table\",\"queue\",\"heap\",\"trie\"],\"big_o\":{\"BFS\":\"O(V+E)\",\"hash lookup\":\"O(1) average\",\"heap insert\":\"O(log V)\",\"trie prefix\":\"O(L)\"},\"engine_us\":%llu}",fg_user_count,edges/2,fg_user_count?(double)edges/fg_user_count:0.0,ht_load_factor(&fg_names),fg_names.collisions,fg_names.max_chain,ticks_us()-start,mt,qt,ticks_us()-start);}
 else if(strstr(path,"/api/common")){char target[96];int other=-1;if(param(path,"target",target,sizeof target))ht_get(&fg_names,target,&other);if(other<0){*status=400;jb_printf(b,"{\"error\":\"Unknown target\",\"engine_us\":%llu}",ticks_us()-start);}else{int ids[128];size_t n=mutual_friends(&fg_graph,uid,other,ids,128);jb_add(b,"{\"mutual_friends\":[");for(size_t i=0;i<n&&i<128;i++){if(i)jb_char(b,',');jb_quote(b,fg_users[ids[i]].name);}jb_printf(b,"],\"count\":%zu,\"engine_us\":%llu}",n,ticks_us()-start);}}
 else if(strstr(path,"/api/top-users")){MaxHeap h;heap_init(&h);int lim=param_int(path,"limit",10);for(size_t i=0;i<fg_user_count;i++)heap_push(&h,(HeapItem){(int)i,(int)fg_graph.adj[i].len});jb_add(b,"{\"users\":[");for(int i=0;i<lim&&h.len;i++){HeapItem it;heap_pop(&h,&it);if(i)jb_char(b,',');jb_printf(b,"{\"id\":%d,\"name\":",it.id);jb_quote(b,fg_users[it.id].name);jb_add(b,",\"handle\":");jb_quote(b,fg_users[it.id].handle);jb_printf(b,",\"connections\":%d}",it.score);}jb_printf(b,"],\"engine_us\":%llu}",ticks_us()-start);heap_free(&h);}
 else if(strstr(path,"/api/communities")){UnionFind u;if(!uf_init(&u,fg_user_count)){*status=500;jb_printf(b,"{\"error\":\"Allocation failed\",\"engine_us\":%llu}",ticks_us()-start);}else{for(size_t i=0;i<fg_user_count;i++)for(size_t j=0;j<fg_graph.adj[i].len;j++)uf_union(&u,(int)i,fg_graph.adj[i].items[j]);jb_add(b,"{\"components\":[");for(size_t i=0;i<fg_user_count;i++){if(i)jb_char(b,',');jb_printf(b,"%d",uf_find(&u,(int)i));}jb_printf(b,"],\"count\":%zu,\"engine_us\":%llu}",uf_components(&u),ticks_us()-start);uf_free(&u);}}
 else if(strstr(path,"/api/blocked")&&!strcmp(method,"GET")){
  FGUser*u=&fg_users[uid];
  jb_add(b,"{\"blocked\":[");
  for(int i=0;i<u->blocked_count;i++){
   if(i)jb_char(b,',');
   emit_user(b,u->blocked[i]);
  }
  jb_printf(b,"],\"count\":%d,\"engine_us\":%llu}",u->blocked_count,ticks_us()-start);
 }
 else if(strstr(path,"/api/block")&&!strcmp(method,"POST")){
  char target_str[96]="";
  param(body,"target",target_str,sizeof target_str);
  if(!target_str[0]) param(body,"to",target_str,sizeof target_str);
  int target = get_user_id_from_str(target_str);
  char action[24]="block";
  param(body,"action",action,sizeof action);
  if(uid < 0 || target < 0 || target == uid){
   *status=400;jb_printf(b,"{\"error\":\"Invalid user or target\",\"engine_us\":%llu}",ticks_us()-start);
  }else{
   FGUser*u=&fg_users[uid];
   int found=-1;
   for(int i=0;i<u->blocked_count;i++)if(u->blocked[i]==target)found=i;
   if(!strcmp(action,"unblock")){
    if(found>=0){u->blocked[found]=u->blocked[--u->blocked_count];}
   }else{
    if(found<0&&u->blocked_count<128)u->blocked[u->blocked_count++]=target;
    if(are_friends(&fg_graph,uid,target)){
     remove_edge(&fg_graph,uid,target);
     persistence_save_edges(&fg_graph);
    }
    int req_changed=0;
    for(size_t i=0;i<fg_request_count;i++){
     if(fg_requests[i].status==0 &&
        ((fg_requests[i].from==uid && fg_requests[i].to==target) ||
         (fg_requests[i].from==target && fg_requests[i].to==uid))){
      fg_requests[i].status=-2;
      req_changed=1;
     }
    }
    if(req_changed) persistence_save_requests();
   }
   jb_printf(b,"{\"ok\":true,\"engine_us\":%llu}",ticks_us()-start);
  }
 }
 else if(strstr(path,"/api/requests/send")&&!strcmp(method,"POST")){
  char to_str[96]="", from_str[96]="";
  param(body,"to",to_str,sizeof to_str);
  param(body,"from",from_str,sizeof from_str);
  int to = get_user_id_from_str(to_str);
  int from = from_str[0] ? get_user_id_from_str(from_str) : uid;
  if(to < 0 || from < 0 || from != uid){
   *status=400;jb_printf(b,"{\"error\":\"Invalid sender or target user\",\"engine_us\":%llu}",ticks_us()-start);
  } else {
   int rid=request_create(from,to);
   if(!rid){*status=400;jb_printf(b,"{\"error\":\"Invalid or duplicate request\",\"engine_us\":%llu}",ticks_us()-start);}
   else jb_printf(b,"{\"ok\":true,\"id\":%d,\"engine_us\":%llu}",rid,ticks_us()-start);
  }
 }
 else if(strstr(path,"/api/requests/respond")&&!strcmp(method,"POST")){
  int rid=param_int(body,"id",-1);
  char action[32]="";
  param(body,"action",action,sizeof action);
  if(rid<1 || (size_t)rid>fg_request_count) {
   *status=400;jb_printf(b,"{\"error\":\"Invalid request ID\",\"engine_us\":%llu}",ticks_us()-start);
  } else {
   FGRequest* r = &fg_requests[rid-1];
   if(r->status != 0) {
    *status=400;jb_printf(b,"{\"error\":\"Request already processed\",\"engine_us\":%llu}",ticks_us()-start);
   } else if(!strcmp(action,"cancel") && uid != r->from) {
    *status=403;jb_printf(b,"{\"error\":\"Not authorized to cancel this request\",\"engine_us\":%llu}",ticks_us()-start);
   } else if((!strcmp(action,"accept") || !strcmp(action,"decline")) && uid != r->to) {
    *status=403;jb_printf(b,"{\"error\":\"Not authorized to respond to this request\",\"engine_us\":%llu}",ticks_us()-start);
   } else if(!request_respond(rid,uid,action)){
    *status=400;jb_printf(b,"{\"error\":\"Request action rejected\",\"engine_us\":%llu}",ticks_us()-start);
   } else {
    jb_printf(b,"{\"ok\":true,\"engine_us\":%llu}",ticks_us()-start);
   }
  }
 }
 else if(strstr(path,"/api/friends/remove")&&!strcmp(method,"POST")){
  char from_str[96]="", to_str[96]="";
  param(body,"from",from_str,sizeof from_str);
  param(body,"to",to_str,sizeof to_str);
  int from_id = from_str[0] ? get_user_id_from_str(from_str) : uid;
  int to_id = get_user_id_from_str(to_str);
  if(from_id < 0 || to_id < 0) {
   *status=400;jb_printf(b,"{\"error\":\"Unknown or invalid user\",\"engine_us\":%llu}",ticks_us()-start);
  } else if(uid != from_id && uid != to_id) {
   *status=403;jb_printf(b,"{\"error\":\"Not authorized to remove friend\",\"engine_us\":%llu}",ticks_us()-start);
  } else if(!are_friends(&fg_graph,from_id,to_id)) {
   *status=400;jb_printf(b,"{\"error\":\"Users are not friends\",\"engine_us\":%llu}",ticks_us()-start);
  } else {
   int ok=remove_edge(&fg_graph,from_id,to_id);
   if(ok){
    stack_push(&fg_undo,(UndoAction){from_id,to_id,0});
    persistence_save_edges(&fg_graph);
    jb_printf(b,"{\"ok\":true,\"engine_us\":%llu}",ticks_us()-start);
   } else {
    *status=404;jb_printf(b,"{\"error\":\"Removal failed\",\"engine_us\":%llu}",ticks_us()-start);
   }
  }
 }
 else if(strstr(path,"/api/undo")&&!strcmp(method,"POST")){UndoAction a;if(stack_pop(&fg_undo,&a)){if(a.was_add)remove_edge(&fg_graph,a.a,a.b);else add_edge(&fg_graph,a.a,a.b);persistence_save_edges(&fg_graph);jb_printf(b,"{\"ok\":true,\"engine_us\":%llu}",ticks_us()-start);}else{*status=400;jb_printf(b,"{\"error\":\"Nothing to undo\",\"engine_us\":%llu}",ticks_us()-start);}}
 else{*status=404;jb_printf(b,"{\"error\":\"API route not found\",\"engine_us\":%llu}",ticks_us()-start);} (void)q;
}

/* O(file size), serves only paths under the frontend directory */
static void serve_static(fg_socket s,const char*url){char path[1024],full[1200];if(!strcmp(url,"/"))url="/index.html";if(strstr(url,"..")){const char*x="Not found";send(s,x,(int)strlen(x),0);return;}snprintf(path,sizeof path,"%s%s",fg_frontend_dir,url);FILE*f=fopen(path,"rb");if(!f){const char*x="Not found";send(s,x,(int)strlen(x),0);return;}fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);char*data=malloc((size_t)n+1);if(!data){fclose(f);return;}fread(data,1,(size_t)n,f);fclose(f);const char*mime=strstr(path,".css")?"text/css":strstr(path,".js")?"text/javascript":strstr(path,".svg")?"image/svg+xml":"text/html; charset=utf-8";int h=snprintf(full,sizeof full,"HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %ld\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",mime,n);send(s,full,h,0);send(s,data,(int)n,0);free(data);}

/* O(1) per accepted connection; requests are handled serially */
int server_run(unsigned short port){
#ifdef _WIN32
 HMODULE ws=LoadLibraryA("ws2_32.dll");if(!ws)return 1;fg_wsa_startup=(FgWsaStartup)GetProcAddress(ws,"WSAStartup");fg_socket_call=(FgSocket)GetProcAddress(ws,"socket");fg_setsockopt=(FgSetSockOpt)GetProcAddress(ws,"setsockopt");fg_htons=(FgHtons)GetProcAddress(ws,"htons");fg_htonl=(FgHtonl)GetProcAddress(ws,"htonl");fg_bind=(FgBind)GetProcAddress(ws,"bind");fg_listen=(FgListen)GetProcAddress(ws,"listen");fg_accept=(FgAccept)GetProcAddress(ws,"accept");fg_recv=(FgRecv)GetProcAddress(ws,"recv");fg_send=(FgSend)GetProcAddress(ws,"send");fg_closesocket=(FgCloseSocket)GetProcAddress(ws,"closesocket");if(!fg_wsa_startup||!fg_socket_call||!fg_setsockopt||!fg_htons||!fg_htonl||!fg_bind||!fg_listen||!fg_accept||!fg_recv||!fg_send||!fg_closesocket)return 1;WSADATA wd;if(WSAStartup(MAKEWORD(2,2),&wd)!=0)return 1;
#endif
 fg_socket srv=socket(AF_INET,SOCK_STREAM,0);
#ifdef _WIN32
 if(srv==INVALID_SOCKET){fputs("FRIENDGRAPH: socket creation failed\n",stderr);return 1;}
#else
 if(srv<0){fputs("FRIENDGRAPH: socket creation failed\n",stderr);return 1;}
#endif
 int opt=1;
#ifdef _WIN32
 setsockopt(srv,SOL_SOCKET,SO_REUSEADDR,(const char*)&opt,sizeof opt);
#else
 setsockopt(srv,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof opt);
#endif
 struct sockaddr_in addr;memset(&addr,0,sizeof addr);addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_ANY);addr.sin_port=htons(port);if(bind(srv,(struct sockaddr*)&addr,sizeof addr)<0){fputs("FRIENDGRAPH: bind failed on requested port\n",stderr);FG_CLOSE(srv);return 1;}if(listen(srv,16)<0){fputs("FRIENDGRAPH: listen failed\n",stderr);FG_CLOSE(srv);return 1;}fputs("FRIENDGRAPH: socket bound and listening\n",stderr);fflush(stderr);
 for(;;){
  fg_socket c=accept(srv,NULL,NULL);
  if(c==FG_BAD_SOCKET)continue;

#ifdef _WIN32
  DWORD tv_ms = 5000;
  setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv_ms, sizeof tv_ms);
#else
  struct timeval tv; tv.tv_sec = 5; tv.tv_usec = 0;
  setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof tv);
#endif

  static char req[65536];
  int total_read = 0;
  int content_len = -1;
  int hdr_len = -1;

  while(total_read < (int)sizeof(req) - 1) {
   int n = (int)recv(c, req + total_read, (int)sizeof(req) - 1 - total_read, 0);
   if(n <= 0) break;
   total_read += n;
   req[total_read] = 0;
   if(hdr_len < 0) {
    char *end = strstr(req, "\r\n\r\n");
    if(end) {
     hdr_len = (int)(end - req) + 4;
     content_len = find_content_length(req);
    }
   }
   if(hdr_len >= 0) {
    if(total_read >= hdr_len + content_len) break;
   }
  }

  if(total_read <= 0){FG_CLOSE(c);continue;}

  char method[16]="GET",url[512]="/";
  sscanf(req,"%15s %511s",method,url);
  if(strncmp(url,"/api/",5)){serve_static(c,url);FG_CLOSE(c);continue;}
  char*body=strstr(req,"\r\n\r\n");body=body?body+4:(char*)"";
  JsonBuf b;jb_init(&b);int status;route_api(method,url,body,&b,&status);
  char head[256];const char*reason=status==200?"OK":status==401?"Unauthorized":status==404?"Not Found":"Bad Request";
  int h=snprintf(head,sizeof head,"HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",status,reason,(unsigned long)b.len);
  send(c,head,h,0);
  if(!strcmp(method,"OPTIONS")){/* Header is sufficient for browser preflight. */}
  else if(b.data)send(c,b.data,(int)b.len,0);
  jb_free(&b);
  FG_CLOSE(c);
 }
}

