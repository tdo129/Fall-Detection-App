#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <strings.h>
#include <math.h>
#include <dirent.h>
#include <sys/stat.h>
#include <errno.h>
#include <ctype.h>

/* ================================================================
 * FALL DETECTION CNN - TRAINING IN PURE C (CPU / Linux / Kaggle)
 * Faithful Float32 rewrite of the Python/TensorFlow training core.
 *
 * Architecture:
 *   Input 150x4
 *   Conv1D 4->16, k=7, s=2, SAME, no bias
 *   BatchNorm + ReLU
 *   Conv1D 16->32, k=5, s=2, SAME, no bias
 *   BatchNorm + ReLU
 *   Conv1D 32->48, k=3, s=2, SAME, no bias
 *   BatchNorm + ReLU
 *   GlobalAveragePooling
 *   Dropout(0.35)
 *   Dense 48->16 + ReLU
 *   Dense 16->2 logits (NO Softmax layer)
 *
 * Loss: sparse categorical cross-entropy from logits
 * Optimizer: Adam
 * ================================================================ */

#define SEED 42u
#define TARGET_FS 25
#define WINDOW_SECONDS 6
#define WINDOW_LEN 150
#define RAW_CH 3
#define IN_CH 4
#define C1 16
#define C2 32
#define C3 48
#define K1 7
#define K2 5
#define K3 3
#define S1 2
#define S2 2
#define S3 2
#define L1 75
#define L2 38
#define L3 19
#define DENSE_H 16
#define NCLASS 2

#define SISFALL_ORIG_FS 200
#define SISFALL_DS_FACTOR 8
#define AM_THRESHOLD 1.6f
#define ACC_RANGE_G 16.0f
#define DROPOUT_RATE 0.35f
#define KEEP_PROB (1.0f - DROPOUT_RATE)
#define MAX_ROTATION_DEG 15.0f
#define MAX_TIME_SHIFT 8
#define JITTER_STD_G 0.02f
#define SCALE_MIN 0.95f
#define SCALE_MAX 1.05f
#define AUGMENT_COPIES 1
#define USE_AUGMENTATION 1

#define DEFAULT_EPOCHS 80
#define DEFAULT_BATCH_SIZE 32
#define DEFAULT_LR 1e-3f
#define MIN_LR 1e-6f
#define BN_EPS 1e-3f
#define BN_MOMENTUM 0.99f
#define ADAM_B1 0.9f
#define ADAM_B2 0.999f
#define ADAM_EPS 1e-7f
#define EARLY_STOP_PATIENCE 10
#define LR_PATIENCE 5
#define MIN_VALIDATION_RECALL 0.95f

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define IDX3(t,c,C) ((t)*(C)+(c))
#define BIDX3(b,t,c,L,C) ((((b)*(L)+(t))*(C))+(c))
#define WIDX(k,ic,oc,IC,OC) ((((k)*(IC)+(ic))*(OC))+(oc))

/* ---------------------------- RNG -------------------------------- */
typedef struct { uint64_t s; } RNG;
static uint64_t rng_u64(RNG *r) {
    uint64_t x = r->s;
    if (x == 0) x = 0x9E3779B97F4A7C15ULL;
    x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
    r->s = x;
    return x * 2685821657736338717ULL;
}
static float rng_uniform(RNG *r) {
    return (float)((rng_u64(r) >> 40) * (1.0 / 16777216.0));
}
static float rng_uniform_range(RNG *r, float a, float b) {
    return a + (b-a)*rng_uniform(r);
}
static int rng_int(RNG *r, int lo, int hi_inclusive) {
    uint64_t span = (uint64_t)(hi_inclusive - lo + 1);
    return lo + (int)(rng_u64(r) % span);
}
static float rng_normal(RNG *r) {
    float u1 = rng_uniform(r);
    float u2 = rng_uniform(r);
    if (u1 < 1e-7f) u1 = 1e-7f;
    return sqrtf(-2.0f * logf(u1)) * cosf(2.0f*(float)M_PI*u2);
}
static void shuffle_int(int *a, int n, RNG *r) {
    for (int i=n-1;i>0;--i) {
        int j = rng_int(r,0,i);
        int tmp=a[i]; a[i]=a[j]; a[j]=tmp;
    }
}

/* ------------------------- DATA TYPES ----------------------------- */
typedef struct {
    float xyz[WINDOW_LEN][RAW_CH];
    int label;
    char subject[32];
} RawSample;

typedef struct {
    RawSample *v;
    int n;
    int cap;
} RawDataset;

typedef struct {
    float *x; /* n * 150 * 4 */
    int *y;
    int n;
} FeatureDataset;

static void raw_push(RawDataset *d, const RawSample *s) {
    if (d->n == d->cap) {
        int nc = d->cap ? d->cap*2 : 256;
        RawSample *nv = (RawSample*)realloc(d->v, (size_t)nc*sizeof(RawSample));
        if (!nv) { fprintf(stderr,"OOM raw dataset\n"); exit(1); }
        d->v=nv; d->cap=nc;
    }
    d->v[d->n++] = *s;
}

/* -------------------------- UTILITIES ----------------------------- */
static float clipf(float x,float lo,float hi){ return x<lo?lo:(x>hi?hi:x); }
static int starts_with_label(const char *name) {
    if (!name || !name[0]) return -1;
    char c=(char)toupper((unsigned char)name[0]);
    if (c=='F') return 1;
    if (c=='D') return 0;
    return -1;
}
static void parent_subject(const char *path, char out[32]) {
    const char *end = strrchr(path, '/');
    if (!end) { snprintf(out, 32, "unknown"); return; }
    const char *beg = end;
    while (beg > path && beg[-1] != '/') beg--;
    size_t len = (size_t)(end - beg);
    if (len > 31) len = 31;
    memcpy(out, beg, len);
    out[len] = '\0';
}

/* ----------------------- SISFALL READER --------------------------- */
static int read_sisfall_raw(const char *path, float **out_xyz, int *out_n) {
    FILE *f=fopen(path,"r");
    if (!f) return 0;
    int cap=4096,n=0;
    float *a=(float*)malloc((size_t)cap*3*sizeof(float));
    if(!a){fclose(f);return 0;}
    char line[512];
    while(fgets(line,sizeof(line),f)) {
        char *p=line,*end=NULL;
        float vals[3]; int ok=1;
        for(int j=0;j<3;j++) {
            while(*p && (isspace((unsigned char)*p)||*p==','||*p==';')) p++;
            errno=0; vals[j]=strtof(p,&end);
            if(end==p || errno==ERANGE){ok=0;break;}
            p=end;
        }
        if(!ok) continue;
        if(n==cap){cap*=2; float *na=(float*)realloc(a,(size_t)cap*3*sizeof(float)); if(!na){free(a);fclose(f);return 0;} a=na;}
        const float scale=32.0f/8192.0f;
        a[n*3+0]=vals[0]*scale;
        a[n*3+1]=vals[1]*scale;
        a[n*3+2]=vals[2]*scale;
        n++;
    }
    fclose(f);
    if(n<100){free(a);return 0;}
    *out_xyz=a; *out_n=n; return 1;
}

static float amag3(const float *v){ return sqrtf(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); }

static void make_window_from_sisfall(const float *raw, int nraw, RawSample *s) {
    /* Transform front -> right and stride-downsample 200 -> 25 Hz.
       Xnew=-Zold, Ynew=Yold, Znew=Xold */
    int nd=(nraw + SISFALL_DS_FACTOR - 1)/SISFALL_DS_FACTOR;
    float *d=(float*)malloc((size_t)nd*3*sizeof(float));
    if(!d){fprintf(stderr,"OOM downsample\n");exit(1);}
    int j=0;
    for(int i=0;i<nraw;i+=SISFALL_DS_FACTOR) {
        float x=raw[i*3+0], y=raw[i*3+1], z=raw[i*3+2];
        d[j*3+0]=-z; d[j*3+1]=y; d[j*3+2]=x; j++;
    }
    nd=j;
    int peak=0; float best=-1.0f; int found=0;
    for(int i=0;i<nd;i++) {
        float m=amag3(&d[i*3]);
        if(m>AM_THRESHOLD){ if(!found || m>best){best=m;peak=i;found=1;} }
    }
    if(!found){ best=-1.0f; for(int i=0;i<nd;i++){float m=amag3(&d[i*3]); if(m>best){best=m;peak=i;}} }
    int start=peak-WINDOW_LEN/2;
    int end=start+WINDOW_LEN;
    if(start<0){start=0;end=WINDOW_LEN;}
    if(end>nd){end=nd;start=nd-WINDOW_LEN;if(start<0)start=0;}
    int copied=0;
    for(int i=start;i<end && copied<WINDOW_LEN;i++,copied++) {
        s->xyz[copied][0]=d[i*3+0]; s->xyz[copied][1]=d[i*3+1]; s->xyz[copied][2]=d[i*3+2];
    }
    if(copied==0){ memset(s->xyz,0,sizeof(s->xyz)); }
    else while(copied<WINDOW_LEN){ memcpy(s->xyz[copied],s->xyz[copied-1],3*sizeof(float)); copied++; }
    free(d);
}

static int has_txt_ext(const char *name){size_t n=strlen(name);return n>=4 && strcasecmp(name+n-4,".txt")==0;}

static void scan_sisfall_dir(const char *dir, RawDataset *out) {
    DIR *dp=opendir(dir); if(!dp){fprintf(stderr,"Cannot open %s\n",dir);return;}
    struct dirent *de;
    while((de=readdir(dp))) {
        if(!strcmp(de->d_name,".")||!strcmp(de->d_name,"..")) continue;
        char path[2048]; snprintf(path,sizeof(path),"%s/%s",dir,de->d_name);
        struct stat st; if(stat(path,&st)!=0) continue;
        if(S_ISDIR(st.st_mode)) { scan_sisfall_dir(path,out); continue; }
        if(!S_ISREG(st.st_mode)||!has_txt_ext(de->d_name)) continue;
        int label=starts_with_label(de->d_name); if(label<0) continue;
        float *raw=NULL; int n=0; if(!read_sisfall_raw(path,&raw,&n)) continue;
        RawSample s; memset(&s,0,sizeof(s)); s.label=label; parent_subject(path,s.subject);
        make_window_from_sisfall(raw,n,&s); free(raw); raw_push(out,&s);
    }
    closedir(dp);
}

/* ------------------------- SPLITTING ------------------------------ */
typedef struct { char name[32]; } Subject;
static int subject_index(Subject *subs,int n,const char *name){for(int i=0;i<n;i++)if(!strcmp(subs[i].name,name))return i;return -1;}
static int both_classes(const RawDataset *d,const int *mask,int wanted){int a=0,f=0;for(int i=0;i<d->n;i++)if(mask[i]==wanted){if(d->v[i].label)a=1;else f=1;}return a&&f;}

static void split_subjectwise(const RawDataset *all, int **train_idx,int *ntr,int **val_idx,int *nv,int **test_idx,int *nt) {
    Subject *subs=(Subject*)calloc((size_t)all->n,sizeof(Subject)); int ns=0;
    for(int i=0;i<all->n;i++) if(subject_index(subs,ns,all->v[i].subject)<0) snprintf(subs[ns++].name,32,"%s",all->v[i].subject);
    int *order=(int*)malloc((size_t)ns*sizeof(int)); int *mask=(int*)malloc((size_t)all->n*sizeof(int));
    int ok=0;
    for(int attempt=0;attempt<500 && !ok;attempt++) {
        for(int i=0;i<ns;i++)order[i]=i;
        RNG r={SEED+(uint64_t)attempt}; shuffle_int(order,ns,&r);
        int ntest=(int)lroundf(0.30f*ns); if(ntest<1)ntest=1; if(ntest>=ns)ntest=ns-1;
        int rem=ns-ntest; int nval=(int)lroundf((0.10f/0.70f)*rem); if(nval<1)nval=1; if(nval>=rem)nval=rem-1;
        for(int i=0;i<all->n;i++){
            int si=subject_index(subs,ns,all->v[i].subject), pos=-1;
            for(int k=0;k<ns;k++)if(order[k]==si){pos=k;break;}
            mask[i]=(pos<ntest)?2:((pos<ntest+nval)?1:0);
        }
        ok=both_classes(all,mask,0)&&both_classes(all,mask,1)&&both_classes(all,mask,2);
    }
    if(!ok){fprintf(stderr,"Could not create subject-wise split with both classes.\n");exit(1);}
    *ntr=*nv=*nt=0; for(int i=0;i<all->n;i++){if(mask[i]==0)(*ntr)++;else if(mask[i]==1)(*nv)++;else (*nt)++;}
    *train_idx=(int*)malloc((size_t)*ntr*sizeof(int)); *val_idx=(int*)malloc((size_t)*nv*sizeof(int)); *test_idx=(int*)malloc((size_t)*nt*sizeof(int));
    int a=0,b=0,c=0;for(int i=0;i<all->n;i++){if(mask[i]==0)(*train_idx)[a++]=i;else if(mask[i]==1)(*val_idx)[b++]=i;else (*test_idx)[c++]=i;}
    printf("Subjects: %d | train samples=%d val=%d test=%d\n",ns,*ntr,*nv,*nt);
    free(subs);free(order);free(mask);
}

/* -------------------- AUGMENT + FEATURES ------------------------- */
static void rotation_matrix(float rx,float ry,float rz,float R[3][3]) {
    float cx=cosf(rx),sx=sinf(rx),cy=cosf(ry),sy=sinf(ry),cz=cosf(rz),sz=sinf(rz);
    float Rx[3][3]={{1,0,0},{0,cx,-sx},{0,sx,cx}};
    float Ry[3][3]={{cy,0,sy},{0,1,0},{-sy,0,cy}};
    float Rz[3][3]={{cz,-sz,0},{sz,cz,0},{0,0,1}};
    float T[3][3]={{0}};
    for(int i=0;i<3;i++)for(int j=0;j<3;j++)for(int k=0;k<3;k++)T[i][j]+=Rz[i][k]*Ry[k][j];
    memset(R,0,9*sizeof(float));for(int i=0;i<3;i++)for(int j=0;j<3;j++)for(int k=0;k<3;k++)R[i][j]+=T[i][k]*Rx[k][j];
}
static void augment_raw(const RawSample *in, RawSample *out, RNG *rng) {
    *out=*in;
    float deg=(float)M_PI/180.0f;
    float R[3][3]; rotation_matrix(rng_uniform_range(rng,-MAX_ROTATION_DEG,MAX_ROTATION_DEG)*deg,rng_uniform_range(rng,-MAX_ROTATION_DEG,MAX_ROTATION_DEG)*deg,rng_uniform_range(rng,-MAX_ROTATION_DEG,MAX_ROTATION_DEG)*deg,R);
    float tmp[WINDOW_LEN][3];
    for(int t=0;t<WINDOW_LEN;t++)for(int i=0;i<3;i++)tmp[t][i]=R[i][0]*in->xyz[t][0]+R[i][1]*in->xyz[t][1]+R[i][2]*in->xyz[t][2];
    int shift=rng_int(rng,-MAX_TIME_SHIFT,MAX_TIME_SHIFT);
    float shifted[WINDOW_LEN][3];
    for(int t=0;t<WINDOW_LEN;t++){
        int src=t-shift; if(src<0)src=0;if(src>=WINDOW_LEN)src=WINDOW_LEN-1;
        memcpy(shifted[t],tmp[src],3*sizeof(float));
    }
    float scale=rng_uniform_range(rng,SCALE_MIN,SCALE_MAX);
    for(int t=0;t<WINDOW_LEN;t++)for(int c=0;c<3;c++)out->xyz[t][c]=shifted[t][c]*scale+JITTER_STD_G*rng_normal(rng);
}
static void sample_to_features(const RawSample *s,float *dst) {
    for(int t=0;t<WINDOW_LEN;t++) {
        float x=clipf(s->xyz[t][0],-ACC_RANGE_G,ACC_RANGE_G)/ACC_RANGE_G;
        float y=clipf(s->xyz[t][1],-ACC_RANGE_G,ACC_RANGE_G)/ACC_RANGE_G;
        float z=clipf(s->xyz[t][2],-ACC_RANGE_G,ACC_RANGE_G)/ACC_RANGE_G;
        float m=amag3(s->xyz[t]); m=clipf(m,0,ACC_RANGE_G)/ACC_RANGE_G;
        dst[IDX3(t,0,IN_CH)]=x; dst[IDX3(t,1,IN_CH)]=y; dst[IDX3(t,2,IN_CH)]=z; dst[IDX3(t,3,IN_CH)]=m;
    }
}
static FeatureDataset build_eval_features(const RawDataset *all,const int *idx,int n) {
    FeatureDataset d={0}; d.n=n; d.x=(float*)malloc((size_t)n*WINDOW_LEN*IN_CH*sizeof(float)); d.y=(int*)malloc((size_t)n*sizeof(int));
    if(!d.x||!d.y){fprintf(stderr,"OOM features\n");exit(1);} for(int i=0;i<n;i++){sample_to_features(&all->v[idx[i]],d.x+(size_t)i*WINDOW_LEN*IN_CH);d.y[i]=all->v[idx[i]].label;} return d;
}
static FeatureDataset build_train_features(const RawDataset *all,const int *idx,int n,RNG *rng) {
    int base=n*(1+(USE_AUGMENTATION?AUGMENT_COPIES:0));
    RawSample *tmp=(RawSample*)malloc((size_t)base*sizeof(RawSample)); int *lab=(int*)malloc((size_t)base*sizeof(int)); int m=0;
    for(int i=0;i<n;i++){tmp[m]=all->v[idx[i]];lab[m]=tmp[m].label;m++;}
    if(USE_AUGMENTATION)for(int cp=0;cp<AUGMENT_COPIES;cp++)for(int i=0;i<n;i++){augment_raw(&all->v[idx[i]],&tmp[m],rng);lab[m]=tmp[m].label;m++;}
    int nadl=0,nfall=0;for(int i=0;i<m;i++)if(lab[i])nfall++;else nadl++;
    if(nfall<nadl){int need=nadl-nfall; RawSample *ntmp=(RawSample*)realloc(tmp,(size_t)(m+need)*sizeof(RawSample));int *nlab=(int*)realloc(lab,(size_t)(m+need)*sizeof(int));if(!ntmp||!nlab){fprintf(stderr,"OOM balance\n");exit(1);}tmp=ntmp;lab=nlab;
        int *fallidx=(int*)malloc((size_t)nfall*sizeof(int));int nf=0;for(int i=0;i<m;i++)if(lab[i])fallidx[nf++]=i;
        for(int k=0;k<need;k++){int src=fallidx[rng_int(rng,0,nf-1)];augment_raw(&tmp[src],&tmp[m],rng);lab[m]=1;m++;} free(fallidx);
    }
    int *ord=(int*)malloc((size_t)m*sizeof(int));for(int i=0;i<m;i++)ord[i]=i;shuffle_int(ord,m,rng);
    FeatureDataset d={0};d.n=m;d.x=(float*)malloc((size_t)m*WINDOW_LEN*IN_CH*sizeof(float));d.y=(int*)malloc((size_t)m*sizeof(int));if(!d.x||!d.y){fprintf(stderr,"OOM train features\n");exit(1);}for(int i=0;i<m;i++){int q=ord[i];sample_to_features(&tmp[q],d.x+(size_t)i*WINDOW_LEN*IN_CH);d.y[i]=lab[q];}
    printf("Training after augmentation/balance: %d samples (ADL=%d Fall=%d)\n",m,nadl,nadl>nfall?nadl:nfall);
    free(tmp);free(lab);free(ord);return d;
}
static void free_features(FeatureDataset *d){free(d->x);free(d->y);memset(d,0,sizeof(*d));}

/* -------------------------- MODEL -------------------------------- */
typedef struct {
    float conv1[K1*IN_CH*C1], conv2[K2*C1*C2], conv3[K3*C2*C3];
    float bn1_g[C1],bn1_b[C1],bn1_rm[C1],bn1_rv[C1];
    float bn2_g[C2],bn2_b[C2],bn2_rm[C2],bn2_rv[C2];
    float bn3_g[C3],bn3_b[C3],bn3_rm[C3],bn3_rv[C3];
    float fc1[ C3*DENSE_H], fc1_b[DENSE_H];
    float fc2[DENSE_H*NCLASS], fc2_b[NCLASS];

    float m_conv1[K1*IN_CH*C1],v_conv1[K1*IN_CH*C1];
    float m_conv2[K2*C1*C2],v_conv2[K2*C1*C2];
    float m_conv3[K3*C2*C3],v_conv3[K3*C2*C3];
    float m_bn1_g[C1],v_bn1_g[C1],m_bn1_b[C1],v_bn1_b[C1];
    float m_bn2_g[C2],v_bn2_g[C2],m_bn2_b[C2],v_bn2_b[C2];
    float m_bn3_g[C3],v_bn3_g[C3],m_bn3_b[C3],v_bn3_b[C3];
    float m_fc1[C3*DENSE_H],v_fc1[C3*DENSE_H],m_fc1_b[DENSE_H],v_fc1_b[DENSE_H];
    float m_fc2[DENSE_H*NCLASS],v_fc2[DENSE_H*NCLASS],m_fc2_b[NCLASS],v_fc2_b[NCLASS];
    uint64_t adam_step;
} Model;

typedef struct {
    float conv1[K1*IN_CH*C1],conv2[K2*C1*C2],conv3[K3*C2*C3];
    float bn1_g[C1],bn1_b[C1],bn2_g[C2],bn2_b[C2],bn3_g[C3],bn3_b[C3];
    float fc1[C3*DENSE_H],fc1_b[DENSE_H],fc2[DENSE_H*NCLASS],fc2_b[NCLASS];
} Grads;

static void glorot(float *w,int n,float fanin,float fanout,RNG *r){float lim=sqrtf(6.0f/(fanin+fanout));for(int i=0;i<n;i++)w[i]=rng_uniform_range(r,-lim,lim);}
static void model_init(Model *m,RNG *r){memset(m,0,sizeof(*m));glorot(m->conv1,K1*IN_CH*C1,K1*IN_CH,K1*C1,r);glorot(m->conv2,K2*C1*C2,K2*C1,K2*C2,r);glorot(m->conv3,K3*C2*C3,K3*C2,K3*C3,r);glorot(m->fc1,C3*DENSE_H,C3,DENSE_H,r);glorot(m->fc2,DENSE_H*NCLASS,DENSE_H,NCLASS,r);for(int i=0;i<C1;i++){m->bn1_g[i]=1;m->bn1_rv[i]=1;}for(int i=0;i<C2;i++){m->bn2_g[i]=1;m->bn2_rv[i]=1;}for(int i=0;i<C3;i++){m->bn3_g[i]=1;m->bn3_rv[i]=1;}}

/* ------------------------ FORWARD OPS ----------------------------- */
static void conv1d_same_forward(const float *x,int B,int Lin,int Cin,const float *w,int K,int stride,int Cout,float *y,int Lout) {
    int total=(Lout-1)*stride+K-Lin; if(total<0)total=0; int pad_left=total/2;
    for(int b=0;b<B;b++)for(int t=0;t<Lout;t++)for(int oc=0;oc<Cout;oc++){
        float s=0; for(int k=0;k<K;k++){int ti=t*stride+k-pad_left;if(ti<0||ti>=Lin)continue;for(int ic=0;ic<Cin;ic++)s+=x[BIDX3(b,ti,ic,Lin,Cin)]*w[WIDX(k,ic,oc,Cin,Cout)];} y[BIDX3(b,t,oc,Lout,Cout)]=s;
    }
}
static void bn_forward(float *x,int B,int L,int C,const float *g,const float *beta,float *rm,float *rv,int training,float *xhat,float *invstd) {
    int N=B*L;
    for(int c=0;c<C;c++){
        float mean=training?0.0f:rm[c],var=training?0.0f:rv[c];
        if(training){for(int b=0;b<B;b++)for(int t=0;t<L;t++)mean+=x[BIDX3(b,t,c,L,C)];mean/=N;for(int b=0;b<B;b++)for(int t=0;t<L;t++){float d=x[BIDX3(b,t,c,L,C)]-mean;var+=d*d;}var/=N;rm[c]=BN_MOMENTUM*rm[c]+(1.0f-BN_MOMENTUM)*mean;rv[c]=BN_MOMENTUM*rv[c]+(1.0f-BN_MOMENTUM)*var;}
        float inv=1.0f/sqrtf(var+BN_EPS); if(invstd)invstd[c]=inv;
        for(int b=0;b<B;b++)for(int t=0;t<L;t++){size_t q=BIDX3(b,t,c,L,C);float h=(x[q]-mean)*inv;if(xhat)xhat[q]=h;x[q]=g[c]*h+beta[c];}
    }
}
static void relu_inplace(float *x,size_t n){for(size_t i=0;i<n;i++)if(x[i]<0)x[i]=0;}
static void gap_forward(const float *x,int B,float *y){for(int b=0;b<B;b++)for(int c=0;c<C3;c++){float s=0;for(int t=0;t<L3;t++)s+=x[BIDX3(b,t,c,L3,C3)];y[b*C3+c]=s/L3;}}
static void dense_forward(const float *x,int B,int I,const float *w,const float *bias,int O,float *y){for(int b=0;b<B;b++)for(int o=0;o<O;o++){float s=bias[o];for(int i=0;i<I;i++)s+=x[b*I+i]*w[i*O+o];y[b*O+o]=s;}}

typedef struct {
    int B;
    float *a1,*h1,*a2,*h2,*a3,*h3;
    float *xhat1,*xhat2,*xhat3;
    float inv1[C1],inv2[C2],inv3[C3];
    float *gap,*drop,*dropmask,*d1pre,*d1,*logits;
} Cache;
static int cache_alloc(Cache *c,int B){memset(c,0,sizeof(*c));c->B=B;size_t n1=(size_t)B*L1*C1,n2=(size_t)B*L2*C2,n3=(size_t)B*L3*C3;c->a1=malloc(n1*sizeof(float));c->h1=malloc(n1*sizeof(float));c->xhat1=malloc(n1*sizeof(float));c->a2=malloc(n2*sizeof(float));c->h2=malloc(n2*sizeof(float));c->xhat2=malloc(n2*sizeof(float));c->a3=malloc(n3*sizeof(float));c->h3=malloc(n3*sizeof(float));c->xhat3=malloc(n3*sizeof(float));c->gap=malloc((size_t)B*C3*sizeof(float));c->drop=malloc((size_t)B*C3*sizeof(float));c->dropmask=malloc((size_t)B*C3*sizeof(float));c->d1pre=malloc((size_t)B*DENSE_H*sizeof(float));c->d1=malloc((size_t)B*DENSE_H*sizeof(float));c->logits=malloc((size_t)B*NCLASS*sizeof(float));return c->a1&&c->h1&&c->xhat1&&c->a2&&c->h2&&c->xhat2&&c->a3&&c->h3&&c->xhat3&&c->gap&&c->drop&&c->dropmask&&c->d1pre&&c->d1&&c->logits;}
static void cache_free(Cache *c){free(c->a1);free(c->h1);free(c->xhat1);free(c->a2);free(c->h2);free(c->xhat2);free(c->a3);free(c->h3);free(c->xhat3);free(c->gap);free(c->drop);free(c->dropmask);free(c->d1pre);free(c->d1);free(c->logits);memset(c,0,sizeof(*c));}
static void model_forward(Model *m,const float *x,int B,int training,RNG *rng,Cache *c){
    conv1d_same_forward(x,B,WINDOW_LEN,IN_CH,m->conv1,K1,S1,C1,c->a1,L1); memcpy(c->h1,c->a1,(size_t)B*L1*C1*sizeof(float));bn_forward(c->h1,B,L1,C1,m->bn1_g,m->bn1_b,m->bn1_rm,m->bn1_rv,training,c->xhat1,c->inv1);relu_inplace(c->h1,(size_t)B*L1*C1);
    conv1d_same_forward(c->h1,B,L1,C1,m->conv2,K2,S2,C2,c->a2,L2); memcpy(c->h2,c->a2,(size_t)B*L2*C2*sizeof(float));bn_forward(c->h2,B,L2,C2,m->bn2_g,m->bn2_b,m->bn2_rm,m->bn2_rv,training,c->xhat2,c->inv2);relu_inplace(c->h2,(size_t)B*L2*C2);
    conv1d_same_forward(c->h2,B,L2,C2,m->conv3,K3,S3,C3,c->a3,L3); memcpy(c->h3,c->a3,(size_t)B*L3*C3*sizeof(float));bn_forward(c->h3,B,L3,C3,m->bn3_g,m->bn3_b,m->bn3_rm,m->bn3_rv,training,c->xhat3,c->inv3);relu_inplace(c->h3,(size_t)B*L3*C3);
    gap_forward(c->h3,B,c->gap);
    for(int i=0;i<B*C3;i++){float mask=1.0f;if(training){mask=(rng_uniform(rng)<KEEP_PROB)?(1.0f/KEEP_PROB):0.0f;}c->dropmask[i]=mask;c->drop[i]=c->gap[i]*mask;}
    dense_forward(c->drop,B,C3,m->fc1,m->fc1_b,DENSE_H,c->d1pre);memcpy(c->d1,c->d1pre,(size_t)B*DENSE_H*sizeof(float));relu_inplace(c->d1,(size_t)B*DENSE_H);
    dense_forward(c->d1,B,DENSE_H,m->fc2,m->fc2_b,NCLASS,c->logits);
}

/* ----------------------- LOSS / BACKWARD -------------------------- */
static float xent_logits(const float *logits,const int *y,int B,float *dlogits){float loss=0;for(int b=0;b<B;b++){float a=logits[b*2],z=logits[b*2+1],mx=a>z?a:z;float e0=expf(a-mx),e1=expf(z-mx),sum=e0+e1;float p0=e0/sum,p1=e1/sum;float py=y[b]?p1:p0;if(py<1e-12f)py=1e-12f;loss-=logf(py);if(dlogits){dlogits[b*2]=(p0-(y[b]==0))/B;dlogits[b*2+1]=(p1-(y[b]==1))/B;}}return loss/B;}
static void dense_backward(const float *x,const float *w,const float *dy,int B,int I,int O,float *dx,float *dw,float *db){memset(dx,0,(size_t)B*I*sizeof(float));for(int b=0;b<B;b++)for(int o=0;o<O;o++){float g=dy[b*O+o];db[o]+=g;for(int i=0;i<I;i++){dw[i*O+o]+=x[b*I+i]*g;dx[b*I+i]+=w[i*O+o]*g;}}}
static void bn_backward(const float *dy,const float *xhat,const float *gamma,const float *inv,int B,int L,int C,float *dx,float *dg,float *db){int N=B*L;for(int c=0;c<C;c++){float s1=0,s2=0;for(int b=0;b<B;b++)for(int t=0;t<L;t++){size_t q=BIDX3(b,t,c,L,C);s1+=dy[q];s2+=dy[q]*xhat[q];dg[c]+=dy[q]*xhat[q];db[c]+=dy[q];}float k=gamma[c]*inv[c]/N;for(int b=0;b<B;b++)for(int t=0;t<L;t++){size_t q=BIDX3(b,t,c,L,C);dx[q]=k*(N*dy[q]-s1-xhat[q]*s2);}}}
static void conv1d_same_backward(const float *x,const float *w,const float *dy,int B,int Lin,int Cin,int K,int stride,int Cout,int Lout,float *dx,float *dw){memset(dx,0,(size_t)B*Lin*Cin*sizeof(float));int total=(Lout-1)*stride+K-Lin;if(total<0)total=0;int pad_left=total/2;for(int b=0;b<B;b++)for(int t=0;t<Lout;t++)for(int oc=0;oc<Cout;oc++){float g=dy[BIDX3(b,t,oc,Lout,Cout)];for(int k=0;k<K;k++){int ti=t*stride+k-pad_left;if(ti<0||ti>=Lin)continue;for(int ic=0;ic<Cin;ic++){size_t xi=BIDX3(b,ti,ic,Lin,Cin),wi=WIDX(k,ic,oc,Cin,Cout);dw[wi]+=x[xi]*g;dx[xi]+=w[wi]*g;}}}}

static void backward(Model *m,const float *x,const int *y,Cache *c,Grads *g,float *loss_out){int B=c->B;memset(g,0,sizeof(*g));float *dlog=calloc((size_t)B*NCLASS,sizeof(float));float *dd1=calloc((size_t)B*DENSE_H,sizeof(float));float *dd1pre=calloc((size_t)B*DENSE_H,sizeof(float));float *ddrop=calloc((size_t)B*C3,sizeof(float));float *dgap=calloc((size_t)B*C3,sizeof(float));float *dh3=calloc((size_t)B*L3*C3,sizeof(float));float *dbn3=calloc((size_t)B*L3*C3,sizeof(float));float *da3=calloc((size_t)B*L3*C3,sizeof(float));float *dh2=calloc((size_t)B*L2*C2,sizeof(float));float *dbn2=calloc((size_t)B*L2*C2,sizeof(float));float *da2=calloc((size_t)B*L2*C2,sizeof(float));float *dh1=calloc((size_t)B*L1*C1,sizeof(float));float *dbn1=calloc((size_t)B*L1*C1,sizeof(float));float *dx0=calloc((size_t)B*WINDOW_LEN*IN_CH,sizeof(float));if(!dlog||!dd1||!dd1pre||!ddrop||!dgap||!dh3||!dbn3||!da3||!dh2||!dbn2||!da2||!dh1||!dbn1||!dx0){fprintf(stderr,"OOM backward\n");exit(1);}*loss_out=xent_logits(c->logits,y,B,dlog);
    dense_backward(c->d1,m->fc2,dlog,B,DENSE_H,NCLASS,dd1,g->fc2,g->fc2_b);for(int i=0;i<B*DENSE_H;i++)dd1pre[i]=(c->d1pre[i]>0)?dd1[i]:0;dense_backward(c->drop,m->fc1,dd1pre,B,C3,DENSE_H,ddrop,g->fc1,g->fc1_b);for(int i=0;i<B*C3;i++)dgap[i]=ddrop[i]*c->dropmask[i];for(int b=0;b<B;b++)for(int t=0;t<L3;t++)for(int cc=0;cc<C3;cc++)dh3[BIDX3(b,t,cc,L3,C3)]=dgap[b*C3+cc]/L3;for(int i=0;i<B*L3*C3;i++)dbn3[i]=(c->h3[i]>0)?dh3[i]:0;bn_backward(dbn3,c->xhat3,m->bn3_g,c->inv3,B,L3,C3,da3,g->bn3_g,g->bn3_b);conv1d_same_backward(c->h2,m->conv3,da3,B,L2,C2,K3,S3,C3,L3,dh2,g->conv3);for(int i=0;i<B*L2*C2;i++)dbn2[i]=(c->h2[i]>0)?dh2[i]:0;bn_backward(dbn2,c->xhat2,m->bn2_g,c->inv2,B,L2,C2,da2,g->bn2_g,g->bn2_b);conv1d_same_backward(c->h1,m->conv2,da2,B,L1,C1,K2,S2,C2,L2,dh1,g->conv2);for(int i=0;i<B*L1*C1;i++)dbn1[i]=(c->h1[i]>0)?dh1[i]:0;
    float *bn1dx=calloc((size_t)B*L1*C1,sizeof(float)); if(!bn1dx){fprintf(stderr,"OOM bn1dx\n");exit(1);} bn_backward(dbn1,c->xhat1,m->bn1_g,c->inv1,B,L1,C1,bn1dx,g->bn1_g,g->bn1_b); conv1d_same_backward(x,m->conv1,bn1dx,B,WINDOW_LEN,IN_CH,K1,S1,C1,L1,dx0,g->conv1); free(bn1dx);
    free(dlog);free(dd1);free(dd1pre);free(ddrop);free(dgap);free(dh3);free(dbn3);free(da3);free(dh2);free(dbn2);free(da2);free(dh1);free(dbn1);free(dx0);
}

/* -------------------------- ADAM --------------------------------- */
static void adam(float *w,const float *grad,float *mm,float *vv,int n,uint64_t step,float lr){float b1corr=1.0f-powf(ADAM_B1,(float)step),b2corr=1.0f-powf(ADAM_B2,(float)step);for(int i=0;i<n;i++){float q=grad[i];mm[i]=ADAM_B1*mm[i]+(1-ADAM_B1)*q;vv[i]=ADAM_B2*vv[i]+(1-ADAM_B2)*q*q;float mh=mm[i]/b1corr,vh=vv[i]/b2corr;w[i]-=lr*mh/(sqrtf(vh)+ADAM_EPS);}}
static void apply_grads(Model *m,const Grads *g,float lr){m->adam_step++;uint64_t s=m->adam_step;adam(m->conv1,g->conv1,m->m_conv1,m->v_conv1,K1*IN_CH*C1,s,lr);adam(m->conv2,g->conv2,m->m_conv2,m->v_conv2,K2*C1*C2,s,lr);adam(m->conv3,g->conv3,m->m_conv3,m->v_conv3,K3*C2*C3,s,lr);adam(m->bn1_g,g->bn1_g,m->m_bn1_g,m->v_bn1_g,C1,s,lr);adam(m->bn1_b,g->bn1_b,m->m_bn1_b,m->v_bn1_b,C1,s,lr);adam(m->bn2_g,g->bn2_g,m->m_bn2_g,m->v_bn2_g,C2,s,lr);adam(m->bn2_b,g->bn2_b,m->m_bn2_b,m->v_bn2_b,C2,s,lr);adam(m->bn3_g,g->bn3_g,m->m_bn3_g,m->v_bn3_g,C3,s,lr);adam(m->bn3_b,g->bn3_b,m->m_bn3_b,m->v_bn3_b,C3,s,lr);adam(m->fc1,g->fc1,m->m_fc1,m->v_fc1,C3*DENSE_H,s,lr);adam(m->fc1_b,g->fc1_b,m->m_fc1_b,m->v_fc1_b,DENSE_H,s,lr);adam(m->fc2,g->fc2,m->m_fc2,m->v_fc2,DENSE_H*NCLASS,s,lr);adam(m->fc2_b,g->fc2_b,m->m_fc2_b,m->v_fc2_b,NCLASS,s,lr);}

/* ------------------------- METRICS ------------------------------- */
typedef struct {float loss,acc,precision,recall,specificity,f1;int tp,tn,fp,fn;} Metrics;
static Metrics eval_model(Model *m,const FeatureDataset *d,int bs,float threshold,int use_threshold){Metrics R={0};R.loss=0;int total=0;R.tp=R.tn=R.fp=R.fn=0;RNG dummy={123};for(int off=0;off<d->n;off+=bs){int B=d->n-off;if(B>bs)B=bs;Cache c;if(!cache_alloc(&c,B)){fprintf(stderr,"OOM cache eval\n");exit(1);}model_forward(m,d->x+(size_t)off*WINDOW_LEN*IN_CH,B,0,&dummy,&c);R.loss+=xent_logits(c.logits,d->y+off,B,NULL)*B;for(int b=0;b<B;b++){float l0=c.logits[b*2],l1=c.logits[b*2+1];int pred=use_threshold?((l1-l0)>=threshold):(l1>l0);int y=d->y[off+b];if(pred&&y)R.tp++;else if(pred&&!y)R.fp++;else if(!pred&&y)R.fn++;else R.tn++;}total+=B;cache_free(&c);}R.loss/=total;R.acc=(float)(R.tp+R.tn)/total;R.precision=(R.tp+R.fp)?(float)R.tp/(R.tp+R.fp):0;R.recall=(R.tp+R.fn)?(float)R.tp/(R.tp+R.fn):0;R.specificity=(R.tn+R.fp)?(float)R.tn/(R.tn+R.fp):0;R.f1=(R.precision+R.recall)?2*R.precision*R.recall/(R.precision+R.recall):0;return R;}
static float collect_margins(Model *m,const FeatureDataset *d,int bs,float **out){float *marg=malloc((size_t)d->n*sizeof(float));RNG dummy={12};for(int off=0;off<d->n;off+=bs){int B=d->n-off;if(B>bs)B=bs;Cache c;if(!cache_alloc(&c,B))exit(1);model_forward(m,d->x+(size_t)off*WINDOW_LEN*IN_CH,B,0,&dummy,&c);for(int b=0;b<B;b++)marg[off+b]=c.logits[b*2+1]-c.logits[b*2];cache_free(&c);}*out=marg;return 0;}
static float tune_threshold(Model *m,const FeatureDataset *val,int bs){if(!val || val->n<=0){fprintf(stderr,"Validation set is empty; threshold defaults to 0.\n");return 0.0f;}float *mg=NULL;collect_margins(m,val,bs,&mg);if(!mg){fprintf(stderr,"Could not allocate validation margins.\n");return 0.0f;}float mn=mg[0],mx=mg[0];for(int i=1;i<val->n;i++){if(mg[i]<mn)mn=mg[i];if(mg[i]>mx)mx=mg[i];}float best=0,bf=-1,br=-1;int found=0;for(int s=0;s<=2000;s++){float th=mn+(mx-mn)*s/2000.0f;int tp=0,fp=0,fn=0;for(int i=0;i<val->n;i++){int p=mg[i]>=th,y=val->y[i];if(p&&y)tp++;else if(p&&!y)fp++;else if(!p&&y)fn++;}float pr=(tp+fp)?(float)tp/(tp+fp):0,rc=(tp+fn)?(float)tp/(tp+fn):0,f=(pr+rc)?2*pr*rc/(pr+rc):0;if(rc>=MIN_VALIDATION_RECALL && f>bf){bf=f;br=rc;best=th;found=1;}}
    if(!found){for(int s=0;s<=2000;s++){float th=mn+(mx-mn)*s/2000.0f;int tp=0,fp=0,fn=0;for(int i=0;i<val->n;i++){int p=mg[i]>=th,y=val->y[i];if(p&&y)tp++;else if(p&&!y)fp++;else if(!p&&y)fn++;}float pr=(tp+fp)?(float)tp/(tp+fp):0,rc=(tp+fn)?(float)tp/(tp+fn):0,f=(pr+rc)?2*pr*rc/(pr+rc):0;if(f>bf){bf=f;br=rc;best=th;}}}
    printf("Tuned float logit-margin threshold: %.6f (val F1=%.4f recall=%.4f)\n",best,bf,br);free(mg);return best;}

/* --------------------------- TRAIN ------------------------------- */
static void gather_batch(const FeatureDataset *d,const int *ord,int off,int B,float *bx,int *by){for(int b=0;b<B;b++){int i=ord[off+b];memcpy(bx+(size_t)b*WINDOW_LEN*IN_CH,d->x+(size_t)i*WINDOW_LEN*IN_CH,(size_t)WINDOW_LEN*IN_CH*sizeof(float));by[b]=d->y[i];}}
static int save_model(const char *path,const Model *m){FILE*f=fopen(path,"wb");if(!f)return 0;size_t z=fwrite(m,sizeof(*m),1,f);fclose(f);return z==1;}
static int load_model(const char *path,Model *m){FILE*f=fopen(path,"rb");if(!f)return 0;size_t z=fread(m,sizeof(*m),1,f);fclose(f);return z==1;}
static void train(Model *m,const FeatureDataset *tr,const FeatureDataset *val,int epochs,int bs,float lr,const char *best_path,RNG *rng){int *ord=malloc((size_t)tr->n*sizeof(int));float *bx=malloc((size_t)bs*WINDOW_LEN*IN_CH*sizeof(float));int *by=malloc((size_t)bs*sizeof(int));if(!ord||!bx||!by)exit(1);float best=INFINITY;int bad=0,lr_bad=0;for(int ep=1;ep<=epochs;ep++){for(int i=0;i<tr->n;i++)ord[i]=i;shuffle_int(ord,tr->n,rng);float sumloss=0;int seen=0,correct=0;for(int off=0;off<tr->n;off+=bs){int B=tr->n-off;if(B>bs)B=bs;gather_batch(tr,ord,off,B,bx,by);Cache c;if(!cache_alloc(&c,B)){fprintf(stderr,"OOM cache train\n");exit(1);}model_forward(m,bx,B,1,rng,&c);Grads g;float loss=0;backward(m,bx,by,&c,&g,&loss);apply_grads(m,&g,lr);for(int b=0;b<B;b++){int p=c.logits[b*2+1]>c.logits[b*2];if(p==by[b])correct++;}sumloss+=loss*B;seen+=B;cache_free(&c);}Metrics vm=eval_model(m,val,bs,0,0);printf("Epoch %3d | lr %.7f | train loss %.6f acc %.2f%% | val loss %.6f acc %.2f%%\n",ep,lr,sumloss/seen,100.0f*correct/seen,vm.loss,100.0f*vm.acc);
        if(vm.loss<best-1e-7f){best=vm.loss;bad=0;lr_bad=0;save_model(best_path,m);}else{bad++;lr_bad++;if(lr_bad>=LR_PATIENCE){float nl=lr*0.5f;if(nl<MIN_LR)nl=MIN_LR;if(nl<lr){lr=nl;printf("  ReduceLROnPlateau -> %.7f\n",lr);}lr_bad=0;}if(bad>=EARLY_STOP_PATIENCE){printf("Early stopping at epoch %d\n",ep);break;}}
    }if(load_model(best_path,m))printf("Restored best validation-loss model from %s\n",best_path);free(ord);free(bx);free(by);}

/* --------------------------- SELF TEST --------------------------- */
static FeatureDataset synthetic_dataset(int n,RNG *r){FeatureDataset d={0};d.n=n;d.x=malloc((size_t)n*WINDOW_LEN*IN_CH*sizeof(float));d.y=malloc((size_t)n*sizeof(int));for(int i=0;i<n;i++){int y=i%2;d.y[i]=y;for(int t=0;t<WINDOW_LEN;t++){float base=y?0.35f:-0.35f;d.x[((size_t)i*WINDOW_LEN+t)*IN_CH+0]=base+0.08f*rng_normal(r);d.x[((size_t)i*WINDOW_LEN+t)*IN_CH+1]=0.05f*rng_normal(r);d.x[((size_t)i*WINDOW_LEN+t)*IN_CH+2]=0.05f*rng_normal(r);d.x[((size_t)i*WINDOW_LEN+t)*IN_CH+3]=fabsf(base)+0.05f*rng_uniform(r);}}return d;}
static int self_test(void){RNG r={SEED};FeatureDataset tr=synthetic_dataset(64,&r),va=synthetic_dataset(32,&r);Model m;model_init(&m,&r);train(&m,&tr,&va,15,16,1e-3f,"/tmp/fall_cnn_selftest.bin",&r);Metrics e=eval_model(&m,&va,16,0,0);printf("SELF TEST accuracy: %.2f%%\n",100*e.acc);free_features(&tr);free_features(&va);return e.acc>0.80f?0:2;}

/* ----------------------------- MAIN ------------------------------ */
static void usage(const char *p){printf("Usage:\n  %s <SisFall_dataset_root> [epochs] [batch_size] [learning_rate]\n  %s --self-test\n",p,p);}
int main(int argc,char **argv){if(argc>=2 && !strcmp(argv[1],"--self-test"))return self_test();if(argc<2){usage(argv[0]);return 1;}const char *root=argv[1];int epochs=argc>2?atoi(argv[2]):DEFAULT_EPOCHS;int bs=argc>3?atoi(argv[3]):DEFAULT_BATCH_SIZE;float lr=argc>4?strtof(argv[4],NULL):DEFAULT_LR;if(epochs<1||bs<1||lr<=0){usage(argv[0]);return 1;}
    printf("Loading SisFall from: %s\n",root);RawDataset all={0};scan_sisfall_dir(root,&all);printf("Loaded %d usable recordings.\n",all.n);if(all.n<10){fprintf(stderr,"Too few samples. Check dataset path.\n");free(all.v);return 1;}
    int *itr=NULL,*iv=NULL,*it=NULL,ntr=0,nv=0,nt=0;split_subjectwise(&all,&itr,&ntr,&iv,&nv,&it,&nt);RNG rng={SEED};FeatureDataset tr=build_train_features(&all,itr,ntr,&rng);FeatureDataset va=build_eval_features(&all,iv,nv);FeatureDataset te=build_eval_features(&all,it,nt);free(itr);free(iv);free(it);
    Model m;model_init(&m,&rng);const char *best="best_float32_c_model.bin";train(&m,&tr,&va,epochs,bs,lr,best,&rng);Metrics a=eval_model(&m,&tr,bs,0,0),b=eval_model(&m,&va,bs,0,0),c=eval_model(&m,&te,bs,0,0);printf("\n=== ARGMAX EVALUATION ===\nTrain loss %.6f acc %.2f%%\nVal   loss %.6f acc %.2f%%\nTest  loss %.6f acc %.2f%%\n",a.loss,100*a.acc,b.loss,100*b.acc,c.loss,100*c.acc);
    float th=tune_threshold(&m,&va,bs);Metrics mt=eval_model(&m,&te,bs,th,1);printf("\n=== TEST WITH TUNED LOGIT MARGIN ===\nThreshold %.6f\nAccuracy %.2f%%\nPrecision %.2f%%\nRecall %.2f%%\nSpecificity %.2f%%\nF1 %.4f\nTP=%d TN=%d FP=%d FN=%d\n",th,100*mt.acc,100*mt.precision,100*mt.recall,100*mt.specificity,mt.f1,mt.tp,mt.tn,mt.fp,mt.fn);
    FILE *tf=fopen("float_logit_threshold.txt","w");if(tf){fprintf(tf,"%.9g\n",th);fclose(tf);}printf("Saved: %s and float_logit_threshold.txt\n",best);
    free_features(&tr);free_features(&va);free_features(&te);free(all.v);return 0;}
