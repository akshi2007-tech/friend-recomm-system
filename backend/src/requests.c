#include "app.h"
#include "requests.h"
#include "persistence.h"
#include <string.h>
/* O(R) */ int request_create(int from,int to){
 if(from<0||to<0||(size_t)from>=fg_user_count||(size_t)to>=fg_user_count||from==to||are_friends(&fg_graph,from,to)||fg_request_count>=512)return 0;
 for(int i=0;i<fg_users[from].blocked_count;i++)if(fg_users[from].blocked[i]==to)return 0;
 for(int i=0;i<fg_users[to].blocked_count;i++)if(fg_users[to].blocked[i]==from)return 0;
 for(size_t i=0;i<fg_request_count;i++)if(fg_requests[i].status==0&&((fg_requests[i].from==from&&fg_requests[i].to==to)||(fg_requests[i].from==to&&fg_requests[i].to==from)))return 0;
 FGRequest*r=&fg_requests[fg_request_count];r->id=(int)fg_request_count+1;r->from=from;r->to=to;r->status=0;fg_request_count++;persistence_save_requests();return r->id;
}
/* O(R) */ int request_respond(int id,int actor,const char*action){if(id<1||(size_t)id>fg_request_count)return 0;FGRequest*r=&fg_requests[id-1];if(r->status!=0)return 0;if(!strcmp(action,"cancel")){if(actor!=r->from)return 0;r->status=-2;}else{if(actor!=r->to)return 0;if(!strcmp(action,"accept")){r->status=1;if(add_edge(&fg_graph,r->from,r->to)<0)return 0;stack_push(&fg_undo,(UndoAction){r->from,r->to,1});persistence_save_edges(&fg_graph);}else{r->status=-1;if(fg_users[r->from].declined_count<128)fg_users[r->from].declined[fg_users[r->from].declined_count++]=r->to;}}persistence_save_requests();return 1;}
