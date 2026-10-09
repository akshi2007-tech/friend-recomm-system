#define main friendgraph_entrypoint
#include "../src/all.c"
#undef main
#include <assert.h>
#include <string.h>
/* O(V+E) across API fixture routes */
int main(void){assert(app_seed());JsonBuf b;int status;jb_init(&b);route_api("GET","/api/health","",&b,&status);assert(status==200&&strstr(b.data,"\"engine_us\""));jb_free(&b);jb_init(&b);route_api("GET","/api/recommendations?user=student01&limit=5&maxDistance=3","",&b,&status);assert(status==200&&strstr(b.data,"\"recommendations\"")&&strstr(b.data,"\"score_breakdown\"")&&strstr(b.data,"\"path\"")&&strstr(b.data,"\"engine_us\""));jb_free(&b);jb_init(&b);route_api("GET","/api/visualize?user=student01&target=student09","",&b,&status);assert(status==200&&strstr(b.data,"\"trace\"")&&strstr(b.data,"\"visited\""));jb_free(&b);jb_init(&b);route_api("GET","/api/stats","",&b,&status);assert(status==200&&strstr(b.data,"\"hash_load_factor\"")&&strstr(b.data,"\"merge_sort_us\"")&&strstr(b.data,"\"engine_us\""));jb_free(&b);jb_init(&b);route_api("GET","/api/blocked?user=student01","",&b,&status);assert(status==200&&strstr(b.data,"\"blocked\""));jb_free(&b);graph_free(&fg_graph);ht_free(&fg_names);stack_free(&fg_undo);return 0;}
