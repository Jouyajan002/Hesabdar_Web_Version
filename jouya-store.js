/**
 * jouya-store.js — موتورِ حافظهٔ APEX Store Manager (نسخهٔ ۲: IndexedDB)
 * ===========================================================================
 *  هدف: برداشتنِ سقفِ ۵ مگابایتیِ localStorage برای همیشه، «بدونِ» تغییر در
 *  هیچ تابعِ برنامه. database.js، script.js، sync-layer.js، auth-cloud.js و … همه
 *  مثلِ قبل localStorage.getItem / setItem / removeItem / key / length را صدا
 *  می‌زنند و همان جواب‌ها را می‌گیرند.
 *
 *  چطور کار می‌کند
 *  ----------------
 *   • هر مقدارِ بزرگ (≥ ۸۱۹۲ کاراکتر) در IndexedDB (پایگاهِ «apex_store») نوشته
 *     می‌شود و در localStorage فقط یک «نشانگرِ» کوچک به جای آن می‌ماند. پس نامِ
 *     کلیدها، شمارِ کلیدها و پیمایشِ localStorage.key(i) دقیقاً مثلِ قبل است.
 *   • همهٔ مقدارهای IndexedDB پیش از اجرای برنامه یک‌جا در حافظهٔ RAM بار می‌شوند
 *     (index.html تا آن لحظه اسکریپت‌های برنامه را اجرا نمی‌کند). پس خواندن
 *     «همگام و فوری» می‌ماند و هیچ تابعی async نشد.
 *   • هر نوشتن همان لحظه در RAM اعمال و بلافاصله (در همان چرخه) در یک تراکنشِ
 *     IndexedDB با durability=strict ثبت می‌شود. چند نوشتنِ پشتِ‌سرِهم (مثلاً ثبتِ
 *     بل: معاملات + اجناس + صندوق) در «یک» تراکنش ثبت می‌شوند — یا همه یا هیچ.
 *   • مقدارهای کوچک (تنظیماتِ دستگاه، ورود، سیستمِ اعداد …) مثلِ قبل در خودِ
 *     localStorage می‌مانند.
 *
 *  ایمنیِ داده
 *  ------------
 *   • انتقالِ اولیه: مقدار اول در IndexedDB نوشته، سپس دوباره خوانده و حرف‌به‌حرف
 *     با اصل مقایسه می‌شود؛ «فقط بعد از آن» اصلِ localStorage با نشانگر جایگزین
 *     می‌شود. قطعِ برق در هر لحظه‌ای از این مسیر، داده را از بین نمی‌برد و دفعهٔ
 *     بعد کار از همان‌جا ادامه می‌یابد (بدونِ رکوردِ تکراری).
 *   • از هر کلید یک نسخهٔ «پیش از انتقال» در مخزنِ backup همین پایگاه نگه داشته
 *     می‌شود؛ اگر نسخهٔ قدیمیِ برنامه یا هر عاملِ بیرونی مقداری را بازنویسی کند،
 *     مقدارِ قبلی هم آن‌جا حفظ می‌شود (JouyaStore.listBackups / restoreBackup).
 *   • اگر نوشتن در IndexedDB شکست بخورد، داده در RAM می‌ماند، خودکار دوباره تلاش
 *     می‌شود و خطا به‌صورتِ واقعی (نوارِ قرمز) به کاربر نشان داده می‌شود.
 *   • اگر داده منتقل شده باشد ولی IndexedDB باز نشود، برنامه «اجرا نمی‌شود» تا
 *     هیچ کدی دادهٔ خالی را روی دادهٔ واقعی ننویسد؛ پیامِ «تلاشِ دوباره» نشان
 *     داده می‌شود.
 *   • اگر IndexedDB در دسترس نباشد و هنوز چیزی منتقل نشده باشد، برنامه دقیقاً
 *     مثلِ نسخهٔ قبلی (localStorage + فشرده‌سازیِ JQZ1) کار می‌کند.
 *   • مقدارهای فشرده‌شدهٔ نسخهٔ قبلیِ این فایل (JQZ1، فقط نسخهٔ وب) خوانده و
 *     هنگامِ انتقال باز می‌شوند.
 *
 *  این فایل باید «اولین اسکریپتِ» <head> باشد و رمزنگاری/obfuscate نشود
 *  (tools/pack-encrypt.js و tools/obfuscate.js آن را رد می‌کنند).
 * ===========================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;
    if (window.JouyaStore || window.__JQ_STORE_READY) return;
    var LS = null;
    try { LS = window.localStorage; } catch (e) { LS = null; }
    if (!LS) return;

    // ── pako 2.1.0 (MIT AND Zlib) — داخلِ یک بستار، بدونِ آلوده‌کردنِ window ──────
    var pako = (function () {
        var exports = {}, module = { exports: exports };
        /*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).pako={})}(this,(function(t){"use strict";function e(t){for(var e=t.length;--e>=0;)t[e]=0}var a=256,n=286,i=30,r=15,s=new Uint8Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]),o=new Uint8Array([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]),l=new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7]),h=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),d=new Array(576);e(d);var _=new Array(60);e(_);var f=new Array(512);e(f);var u=new Array(256);e(u);var c=new Array(29);e(c);var w,m,b,g=new Array(i);function p(t,e,a,n,i){this.static_tree=t,this.extra_bits=e,this.extra_base=a,this.elems=n,this.max_length=i,this.has_stree=t&&t.length}function v(t,e){this.dyn_tree=t,this.max_code=0,this.stat_desc=e}e(g);var k=function(t){return t<256?f[t]:f[256+(t>>>7)]},y=function(t,e){t.pending_buf[t.pending++]=255&e,t.pending_buf[t.pending++]=e>>>8&255},x=function(t,e,a){t.bi_valid>16-a?(t.bi_buf|=e<<t.bi_valid&65535,y(t,t.bi_buf),t.bi_buf=e>>16-t.bi_valid,t.bi_valid+=a-16):(t.bi_buf|=e<<t.bi_valid&65535,t.bi_valid+=a)},z=function(t,e,a){x(t,a[2*e],a[2*e+1])},A=function(t,e){var a=0;do{a|=1&t,t>>>=1,a<<=1}while(--e>0);return a>>>1},E=function(t,e,a){var n,i,s=new Array(16),o=0;for(n=1;n<=r;n++)o=o+a[n-1]<<1,s[n]=o;for(i=0;i<=e;i++){var l=t[2*i+1];0!==l&&(t[2*i]=A(s[l]++,l))}},R=function(t){var e;for(e=0;e<n;e++)t.dyn_ltree[2*e]=0;for(e=0;e<i;e++)t.dyn_dtree[2*e]=0;for(e=0;e<19;e++)t.bl_tree[2*e]=0;t.dyn_ltree[512]=1,t.opt_len=t.static_len=0,t.sym_next=t.matches=0},Z=function(t){t.bi_valid>8?y(t,t.bi_buf):t.bi_valid>0&&(t.pending_buf[t.pending++]=t.bi_buf),t.bi_buf=0,t.bi_valid=0},S=function(t,e,a,n){var i=2*e,r=2*a;return t[i]<t[r]||t[i]===t[r]&&n[e]<=n[a]},U=function(t,e,a){for(var n=t.heap[a],i=a<<1;i<=t.heap_len&&(i<t.heap_len&&S(e,t.heap[i+1],t.heap[i],t.depth)&&i++,!S(e,n,t.heap[i],t.depth));)t.heap[a]=t.heap[i],a=i,i<<=1;t.heap[a]=n},D=function(t,e,n){var i,r,l,h,d=0;if(0!==t.sym_next)do{i=255&t.pending_buf[t.sym_buf+d++],i+=(255&t.pending_buf[t.sym_buf+d++])<<8,r=t.pending_buf[t.sym_buf+d++],0===i?z(t,r,e):(l=u[r],z(t,l+a+1,e),0!==(h=s[l])&&(r-=c[l],x(t,r,h)),i--,l=k(i),z(t,l,n),0!==(h=o[l])&&(i-=g[l],x(t,i,h)))}while(d<t.sym_next);z(t,256,e)},T=function(t,e){var a,n,i,s=e.dyn_tree,o=e.stat_desc.static_tree,l=e.stat_desc.has_stree,h=e.stat_desc.elems,d=-1;for(t.heap_len=0,t.heap_max=573,a=0;a<h;a++)0!==s[2*a]?(t.heap[++t.heap_len]=d=a,t.depth[a]=0):s[2*a+1]=0;for(;t.heap_len<2;)s[2*(i=t.heap[++t.heap_len]=d<2?++d:0)]=1,t.depth[i]=0,t.opt_len--,l&&(t.static_len-=o[2*i+1]);for(e.max_code=d,a=t.heap_len>>1;a>=1;a--)U(t,s,a);i=h;do{a=t.heap[1],t.heap[1]=t.heap[t.heap_len--],U(t,s,1),n=t.heap[1],t.heap[--t.heap_max]=a,t.heap[--t.heap_max]=n,s[2*i]=s[2*a]+s[2*n],t.depth[i]=(t.depth[a]>=t.depth[n]?t.depth[a]:t.depth[n])+1,s[2*a+1]=s[2*n+1]=i,t.heap[1]=i++,U(t,s,1)}while(t.heap_len>=2);t.heap[--t.heap_max]=t.heap[1],function(t,e){var a,n,i,s,o,l,h=e.dyn_tree,d=e.max_code,_=e.stat_desc.static_tree,f=e.stat_desc.has_stree,u=e.stat_desc.extra_bits,c=e.stat_desc.extra_base,w=e.stat_desc.max_length,m=0;for(s=0;s<=r;s++)t.bl_count[s]=0;for(h[2*t.heap[t.heap_max]+1]=0,a=t.heap_max+1;a<573;a++)(s=h[2*h[2*(n=t.heap[a])+1]+1]+1)>w&&(s=w,m++),h[2*n+1]=s,n>d||(t.bl_count[s]++,o=0,n>=c&&(o=u[n-c]),l=h[2*n],t.opt_len+=l*(s+o),f&&(t.static_len+=l*(_[2*n+1]+o)));if(0!==m){do{for(s=w-1;0===t.bl_count[s];)s--;t.bl_count[s]--,t.bl_count[s+1]+=2,t.bl_count[w]--,m-=2}while(m>0);for(s=w;0!==s;s--)for(n=t.bl_count[s];0!==n;)(i=t.heap[--a])>d||(h[2*i+1]!==s&&(t.opt_len+=(s-h[2*i+1])*h[2*i],h[2*i+1]=s),n--)}}(t,e),E(s,d,t.bl_count)},O=function(t,e,a){var n,i,r=-1,s=e[1],o=0,l=7,h=4;for(0===s&&(l=138,h=3),e[2*(a+1)+1]=65535,n=0;n<=a;n++)i=s,s=e[2*(n+1)+1],++o<l&&i===s||(o<h?t.bl_tree[2*i]+=o:0!==i?(i!==r&&t.bl_tree[2*i]++,t.bl_tree[32]++):o<=10?t.bl_tree[34]++:t.bl_tree[36]++,o=0,r=i,0===s?(l=138,h=3):i===s?(l=6,h=3):(l=7,h=4))},I=function(t,e,a){var n,i,r=-1,s=e[1],o=0,l=7,h=4;for(0===s&&(l=138,h=3),n=0;n<=a;n++)if(i=s,s=e[2*(n+1)+1],!(++o<l&&i===s)){if(o<h)do{z(t,i,t.bl_tree)}while(0!=--o);else 0!==i?(i!==r&&(z(t,i,t.bl_tree),o--),z(t,16,t.bl_tree),x(t,o-3,2)):o<=10?(z(t,17,t.bl_tree),x(t,o-3,3)):(z(t,18,t.bl_tree),x(t,o-11,7));o=0,r=i,0===s?(l=138,h=3):i===s?(l=6,h=3):(l=7,h=4)}},F=!1,L=function(t,e,a,n){x(t,0+(n?1:0),3),Z(t),y(t,a),y(t,~a),a&&t.pending_buf.set(t.window.subarray(e,e+a),t.pending),t.pending+=a},N=function(t,e,n,i){var r,s,o=0;t.level>0?(2===t.strm.data_type&&(t.strm.data_type=function(t){var e,n=4093624447;for(e=0;e<=31;e++,n>>>=1)if(1&n&&0!==t.dyn_ltree[2*e])return 0;if(0!==t.dyn_ltree[18]||0!==t.dyn_ltree[20]||0!==t.dyn_ltree[26])return 1;for(e=32;e<a;e++)if(0!==t.dyn_ltree[2*e])return 1;return 0}(t)),T(t,t.l_desc),T(t,t.d_desc),o=function(t){var e;for(O(t,t.dyn_ltree,t.l_desc.max_code),O(t,t.dyn_dtree,t.d_desc.max_code),T(t,t.bl_desc),e=18;e>=3&&0===t.bl_tree[2*h[e]+1];e--);return t.opt_len+=3*(e+1)+5+5+4,e}(t),r=t.opt_len+3+7>>>3,(s=t.static_len+3+7>>>3)<=r&&(r=s)):r=s=n+5,n+4<=r&&-1!==e?L(t,e,n,i):4===t.strategy||s===r?(x(t,2+(i?1:0),3),D(t,d,_)):(x(t,4+(i?1:0),3),function(t,e,a,n){var i;for(x(t,e-257,5),x(t,a-1,5),x(t,n-4,4),i=0;i<n;i++)x(t,t.bl_tree[2*h[i]+1],3);I(t,t.dyn_ltree,e-1),I(t,t.dyn_dtree,a-1)}(t,t.l_desc.max_code+1,t.d_desc.max_code+1,o+1),D(t,t.dyn_ltree,t.dyn_dtree)),R(t),i&&Z(t)},B={_tr_init:function(t){F||(!function(){var t,e,a,h,v,k=new Array(16);for(a=0,h=0;h<28;h++)for(c[h]=a,t=0;t<1<<s[h];t++)u[a++]=h;for(u[a-1]=h,v=0,h=0;h<16;h++)for(g[h]=v,t=0;t<1<<o[h];t++)f[v++]=h;for(v>>=7;h<i;h++)for(g[h]=v<<7,t=0;t<1<<o[h]-7;t++)f[256+v++]=h;for(e=0;e<=r;e++)k[e]=0;for(t=0;t<=143;)d[2*t+1]=8,t++,k[8]++;for(;t<=255;)d[2*t+1]=9,t++,k[9]++;for(;t<=279;)d[2*t+1]=7,t++,k[7]++;for(;t<=287;)d[2*t+1]=8,t++,k[8]++;for(E(d,287,k),t=0;t<i;t++)_[2*t+1]=5,_[2*t]=A(t,5);w=new p(d,s,257,n,r),m=new p(_,o,0,i,r),b=new p(new Array(0),l,0,19,7)}(),F=!0),t.l_desc=new v(t.dyn_ltree,w),t.d_desc=new v(t.dyn_dtree,m),t.bl_desc=new v(t.bl_tree,b),t.bi_buf=0,t.bi_valid=0,R(t)},_tr_stored_block:L,_tr_flush_block:N,_tr_tally:function(t,e,n){return t.pending_buf[t.sym_buf+t.sym_next++]=e,t.pending_buf[t.sym_buf+t.sym_next++]=e>>8,t.pending_buf[t.sym_buf+t.sym_next++]=n,0===e?t.dyn_ltree[2*n]++:(t.matches++,e--,t.dyn_ltree[2*(u[n]+a+1)]++,t.dyn_dtree[2*k(e)]++),t.sym_next===t.sym_end},_tr_align:function(t){x(t,2,3),z(t,256,d),function(t){16===t.bi_valid?(y(t,t.bi_buf),t.bi_buf=0,t.bi_valid=0):t.bi_valid>=8&&(t.pending_buf[t.pending++]=255&t.bi_buf,t.bi_buf>>=8,t.bi_valid-=8)}(t)}},C=function(t,e,a,n){for(var i=65535&t|0,r=t>>>16&65535|0,s=0;0!==a;){a-=s=a>2e3?2e3:a;do{r=r+(i=i+e[n++]|0)|0}while(--s);i%=65521,r%=65521}return i|r<<16|0},M=new Uint32Array(function(){for(var t,e=[],a=0;a<256;a++){t=a;for(var n=0;n<8;n++)t=1&t?3988292384^t>>>1:t>>>1;e[a]=t}return e}()),H=function(t,e,a,n){var i=M,r=n+a;t^=-1;for(var s=n;s<r;s++)t=t>>>8^i[255&(t^e[s])];return-1^t},j={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"},K={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8},P=B._tr_init,Y=B._tr_stored_block,G=B._tr_flush_block,X=B._tr_tally,W=B._tr_align,q=K.Z_NO_FLUSH,J=K.Z_PARTIAL_FLUSH,Q=K.Z_FULL_FLUSH,V=K.Z_FINISH,$=K.Z_BLOCK,tt=K.Z_OK,et=K.Z_STREAM_END,at=K.Z_STREAM_ERROR,nt=K.Z_DATA_ERROR,it=K.Z_BUF_ERROR,rt=K.Z_DEFAULT_COMPRESSION,st=K.Z_FILTERED,ot=K.Z_HUFFMAN_ONLY,lt=K.Z_RLE,ht=K.Z_FIXED,dt=K.Z_DEFAULT_STRATEGY,_t=K.Z_UNKNOWN,ft=K.Z_DEFLATED,ut=258,ct=262,wt=42,mt=113,bt=666,gt=function(t,e){return t.msg=j[e],e},pt=function(t){return 2*t-(t>4?9:0)},vt=function(t){for(var e=t.length;--e>=0;)t[e]=0},kt=function(t){var e,a,n,i=t.w_size;n=e=t.hash_size;do{a=t.head[--n],t.head[n]=a>=i?a-i:0}while(--e);n=e=i;do{a=t.prev[--n],t.prev[n]=a>=i?a-i:0}while(--e)},yt=function(t,e,a){return(e<<t.hash_shift^a)&t.hash_mask},xt=function(t){var e=t.state,a=e.pending;a>t.avail_out&&(a=t.avail_out),0!==a&&(t.output.set(e.pending_buf.subarray(e.pending_out,e.pending_out+a),t.next_out),t.next_out+=a,e.pending_out+=a,t.total_out+=a,t.avail_out-=a,e.pending-=a,0===e.pending&&(e.pending_out=0))},zt=function(t,e){G(t,t.block_start>=0?t.block_start:-1,t.strstart-t.block_start,e),t.block_start=t.strstart,xt(t.strm)},At=function(t,e){t.pending_buf[t.pending++]=e},Et=function(t,e){t.pending_buf[t.pending++]=e>>>8&255,t.pending_buf[t.pending++]=255&e},Rt=function(t,e,a,n){var i=t.avail_in;return i>n&&(i=n),0===i?0:(t.avail_in-=i,e.set(t.input.subarray(t.next_in,t.next_in+i),a),1===t.state.wrap?t.adler=C(t.adler,e,i,a):2===t.state.wrap&&(t.adler=H(t.adler,e,i,a)),t.next_in+=i,t.total_in+=i,i)},Zt=function(t,e){var a,n,i=t.max_chain_length,r=t.strstart,s=t.prev_length,o=t.nice_match,l=t.strstart>t.w_size-ct?t.strstart-(t.w_size-ct):0,h=t.window,d=t.w_mask,_=t.prev,f=t.strstart+ut,u=h[r+s-1],c=h[r+s];t.prev_length>=t.good_match&&(i>>=2),o>t.lookahead&&(o=t.lookahead);do{if(h[(a=e)+s]===c&&h[a+s-1]===u&&h[a]===h[r]&&h[++a]===h[r+1]){r+=2,a++;do{}while(h[++r]===h[++a]&&h[++r]===h[++a]&&h[++r]===h[++a]&&h[++r]===h[++a]&&h[++r]===h[++a]&&h[++r]===h[++a]&&h[++r]===h[++a]&&h[++r]===h[++a]&&r<f);if(n=ut-(f-r),r=f-ut,n>s){if(t.match_start=e,s=n,n>=o)break;u=h[r+s-1],c=h[r+s]}}}while((e=_[e&d])>l&&0!=--i);return s<=t.lookahead?s:t.lookahead},St=function(t){var e,a,n,i=t.w_size;do{if(a=t.window_size-t.lookahead-t.strstart,t.strstart>=i+(i-ct)&&(t.window.set(t.window.subarray(i,i+i-a),0),t.match_start-=i,t.strstart-=i,t.block_start-=i,t.insert>t.strstart&&(t.insert=t.strstart),kt(t),a+=i),0===t.strm.avail_in)break;if(e=Rt(t.strm,t.window,t.strstart+t.lookahead,a),t.lookahead+=e,t.lookahead+t.insert>=3)for(n=t.strstart-t.insert,t.ins_h=t.window[n],t.ins_h=yt(t,t.ins_h,t.window[n+1]);t.insert&&(t.ins_h=yt(t,t.ins_h,t.window[n+3-1]),t.prev[n&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=n,n++,t.insert--,!(t.lookahead+t.insert<3)););}while(t.lookahead<ct&&0!==t.strm.avail_in)},Ut=function(t,e){var a,n,i,r=t.pending_buf_size-5>t.w_size?t.w_size:t.pending_buf_size-5,s=0,o=t.strm.avail_in;do{if(a=65535,i=t.bi_valid+42>>3,t.strm.avail_out<i)break;if(i=t.strm.avail_out-i,a>(n=t.strstart-t.block_start)+t.strm.avail_in&&(a=n+t.strm.avail_in),a>i&&(a=i),a<r&&(0===a&&e!==V||e===q||a!==n+t.strm.avail_in))break;s=e===V&&a===n+t.strm.avail_in?1:0,Y(t,0,0,s),t.pending_buf[t.pending-4]=a,t.pending_buf[t.pending-3]=a>>8,t.pending_buf[t.pending-2]=~a,t.pending_buf[t.pending-1]=~a>>8,xt(t.strm),n&&(n>a&&(n=a),t.strm.output.set(t.window.subarray(t.block_start,t.block_start+n),t.strm.next_out),t.strm.next_out+=n,t.strm.avail_out-=n,t.strm.total_out+=n,t.block_start+=n,a-=n),a&&(Rt(t.strm,t.strm.output,t.strm.next_out,a),t.strm.next_out+=a,t.strm.avail_out-=a,t.strm.total_out+=a)}while(0===s);return(o-=t.strm.avail_in)&&(o>=t.w_size?(t.matches=2,t.window.set(t.strm.input.subarray(t.strm.next_in-t.w_size,t.strm.next_in),0),t.strstart=t.w_size,t.insert=t.strstart):(t.window_size-t.strstart<=o&&(t.strstart-=t.w_size,t.window.set(t.window.subarray(t.w_size,t.w_size+t.strstart),0),t.matches<2&&t.matches++,t.insert>t.strstart&&(t.insert=t.strstart)),t.window.set(t.strm.input.subarray(t.strm.next_in-o,t.strm.next_in),t.strstart),t.strstart+=o,t.insert+=o>t.w_size-t.insert?t.w_size-t.insert:o),t.block_start=t.strstart),t.high_water<t.strstart&&(t.high_water=t.strstart),s?4:e!==q&&e!==V&&0===t.strm.avail_in&&t.strstart===t.block_start?2:(i=t.window_size-t.strstart,t.strm.avail_in>i&&t.block_start>=t.w_size&&(t.block_start-=t.w_size,t.strstart-=t.w_size,t.window.set(t.window.subarray(t.w_size,t.w_size+t.strstart),0),t.matches<2&&t.matches++,i+=t.w_size,t.insert>t.strstart&&(t.insert=t.strstart)),i>t.strm.avail_in&&(i=t.strm.avail_in),i&&(Rt(t.strm,t.window,t.strstart,i),t.strstart+=i,t.insert+=i>t.w_size-t.insert?t.w_size-t.insert:i),t.high_water<t.strstart&&(t.high_water=t.strstart),i=t.bi_valid+42>>3,r=(i=t.pending_buf_size-i>65535?65535:t.pending_buf_size-i)>t.w_size?t.w_size:i,((n=t.strstart-t.block_start)>=r||(n||e===V)&&e!==q&&0===t.strm.avail_in&&n<=i)&&(a=n>i?i:n,s=e===V&&0===t.strm.avail_in&&a===n?1:0,Y(t,t.block_start,a,s),t.block_start+=a,xt(t.strm)),s?3:1)},Dt=function(t,e){for(var a,n;;){if(t.lookahead<ct){if(St(t),t.lookahead<ct&&e===q)return 1;if(0===t.lookahead)break}if(a=0,t.lookahead>=3&&(t.ins_h=yt(t,t.ins_h,t.window[t.strstart+3-1]),a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),0!==a&&t.strstart-a<=t.w_size-ct&&(t.match_length=Zt(t,a)),t.match_length>=3)if(n=X(t,t.strstart-t.match_start,t.match_length-3),t.lookahead-=t.match_length,t.match_length<=t.max_lazy_match&&t.lookahead>=3){t.match_length--;do{t.strstart++,t.ins_h=yt(t,t.ins_h,t.window[t.strstart+3-1]),a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart}while(0!=--t.match_length);t.strstart++}else t.strstart+=t.match_length,t.match_length=0,t.ins_h=t.window[t.strstart],t.ins_h=yt(t,t.ins_h,t.window[t.strstart+1]);else n=X(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++;if(n&&(zt(t,!1),0===t.strm.avail_out))return 1}return t.insert=t.strstart<2?t.strstart:2,e===V?(zt(t,!0),0===t.strm.avail_out?3:4):t.sym_next&&(zt(t,!1),0===t.strm.avail_out)?1:2},Tt=function(t,e){for(var a,n,i;;){if(t.lookahead<ct){if(St(t),t.lookahead<ct&&e===q)return 1;if(0===t.lookahead)break}if(a=0,t.lookahead>=3&&(t.ins_h=yt(t,t.ins_h,t.window[t.strstart+3-1]),a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),t.prev_length=t.match_length,t.prev_match=t.match_start,t.match_length=2,0!==a&&t.prev_length<t.max_lazy_match&&t.strstart-a<=t.w_size-ct&&(t.match_length=Zt(t,a),t.match_length<=5&&(t.strategy===st||3===t.match_length&&t.strstart-t.match_start>4096)&&(t.match_length=2)),t.prev_length>=3&&t.match_length<=t.prev_length){i=t.strstart+t.lookahead-3,n=X(t,t.strstart-1-t.prev_match,t.prev_length-3),t.lookahead-=t.prev_length-1,t.prev_length-=2;do{++t.strstart<=i&&(t.ins_h=yt(t,t.ins_h,t.window[t.strstart+3-1]),a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart)}while(0!=--t.prev_length);if(t.match_available=0,t.match_length=2,t.strstart++,n&&(zt(t,!1),0===t.strm.avail_out))return 1}else if(t.match_available){if((n=X(t,0,t.window[t.strstart-1]))&&zt(t,!1),t.strstart++,t.lookahead--,0===t.strm.avail_out)return 1}else t.match_available=1,t.strstart++,t.lookahead--}return t.match_available&&(n=X(t,0,t.window[t.strstart-1]),t.match_available=0),t.insert=t.strstart<2?t.strstart:2,e===V?(zt(t,!0),0===t.strm.avail_out?3:4):t.sym_next&&(zt(t,!1),0===t.strm.avail_out)?1:2};function Ot(t,e,a,n,i){this.good_length=t,this.max_lazy=e,this.nice_length=a,this.max_chain=n,this.func=i}var It=[new Ot(0,0,0,0,Ut),new Ot(4,4,8,4,Dt),new Ot(4,5,16,8,Dt),new Ot(4,6,32,32,Dt),new Ot(4,4,16,16,Tt),new Ot(8,16,32,32,Tt),new Ot(8,16,128,128,Tt),new Ot(8,32,128,256,Tt),new Ot(32,128,258,1024,Tt),new Ot(32,258,258,4096,Tt)];function Ft(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=ft,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new Uint16Array(1146),this.dyn_dtree=new Uint16Array(122),this.bl_tree=new Uint16Array(78),vt(this.dyn_ltree),vt(this.dyn_dtree),vt(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new Uint16Array(16),this.heap=new Uint16Array(573),vt(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new Uint16Array(573),vt(this.depth),this.sym_buf=0,this.lit_bufsize=0,this.sym_next=0,this.sym_end=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}var Lt=function(t){if(!t)return 1;var e=t.state;return!e||e.strm!==t||e.status!==wt&&57!==e.status&&69!==e.status&&73!==e.status&&91!==e.status&&103!==e.status&&e.status!==mt&&e.status!==bt?1:0},Nt=function(t){if(Lt(t))return gt(t,at);t.total_in=t.total_out=0,t.data_type=_t;var e=t.state;return e.pending=0,e.pending_out=0,e.wrap<0&&(e.wrap=-e.wrap),e.status=2===e.wrap?57:e.wrap?wt:mt,t.adler=2===e.wrap?0:1,e.last_flush=-2,P(e),tt},Bt=function(t){var e,a=Nt(t);return a===tt&&((e=t.state).window_size=2*e.w_size,vt(e.head),e.max_lazy_match=It[e.level].max_lazy,e.good_match=It[e.level].good_length,e.nice_match=It[e.level].nice_length,e.max_chain_length=It[e.level].max_chain,e.strstart=0,e.block_start=0,e.lookahead=0,e.insert=0,e.match_length=e.prev_length=2,e.match_available=0,e.ins_h=0),a},Ct=function(t,e,a,n,i,r){if(!t)return at;var s=1;if(e===rt&&(e=6),n<0?(s=0,n=-n):n>15&&(s=2,n-=16),i<1||i>9||a!==ft||n<8||n>15||e<0||e>9||r<0||r>ht||8===n&&1!==s)return gt(t,at);8===n&&(n=9);var o=new Ft;return t.state=o,o.strm=t,o.status=wt,o.wrap=s,o.gzhead=null,o.w_bits=n,o.w_size=1<<o.w_bits,o.w_mask=o.w_size-1,o.hash_bits=i+7,o.hash_size=1<<o.hash_bits,o.hash_mask=o.hash_size-1,o.hash_shift=~~((o.hash_bits+3-1)/3),o.window=new Uint8Array(2*o.w_size),o.head=new Uint16Array(o.hash_size),o.prev=new Uint16Array(o.w_size),o.lit_bufsize=1<<i+6,o.pending_buf_size=4*o.lit_bufsize,o.pending_buf=new Uint8Array(o.pending_buf_size),o.sym_buf=o.lit_bufsize,o.sym_end=3*(o.lit_bufsize-1),o.level=e,o.strategy=r,o.method=a,Bt(t)},Mt={deflateInit:function(t,e){return Ct(t,e,ft,15,8,dt)},deflateInit2:Ct,deflateReset:Bt,deflateResetKeep:Nt,deflateSetHeader:function(t,e){return Lt(t)||2!==t.state.wrap?at:(t.state.gzhead=e,tt)},deflate:function(t,e){if(Lt(t)||e>$||e<0)return t?gt(t,at):at;var a=t.state;if(!t.output||0!==t.avail_in&&!t.input||a.status===bt&&e!==V)return gt(t,0===t.avail_out?it:at);var n=a.last_flush;if(a.last_flush=e,0!==a.pending){if(xt(t),0===t.avail_out)return a.last_flush=-1,tt}else if(0===t.avail_in&&pt(e)<=pt(n)&&e!==V)return gt(t,it);if(a.status===bt&&0!==t.avail_in)return gt(t,it);if(a.status===wt&&0===a.wrap&&(a.status=mt),a.status===wt){var i=ft+(a.w_bits-8<<4)<<8;if(i|=(a.strategy>=ot||a.level<2?0:a.level<6?1:6===a.level?2:3)<<6,0!==a.strstart&&(i|=32),Et(a,i+=31-i%31),0!==a.strstart&&(Et(a,t.adler>>>16),Et(a,65535&t.adler)),t.adler=1,a.status=mt,xt(t),0!==a.pending)return a.last_flush=-1,tt}if(57===a.status)if(t.adler=0,At(a,31),At(a,139),At(a,8),a.gzhead)At(a,(a.gzhead.text?1:0)+(a.gzhead.hcrc?2:0)+(a.gzhead.extra?4:0)+(a.gzhead.name?8:0)+(a.gzhead.comment?16:0)),At(a,255&a.gzhead.time),At(a,a.gzhead.time>>8&255),At(a,a.gzhead.time>>16&255),At(a,a.gzhead.time>>24&255),At(a,9===a.level?2:a.strategy>=ot||a.level<2?4:0),At(a,255&a.gzhead.os),a.gzhead.extra&&a.gzhead.extra.length&&(At(a,255&a.gzhead.extra.length),At(a,a.gzhead.extra.length>>8&255)),a.gzhead.hcrc&&(t.adler=H(t.adler,a.pending_buf,a.pending,0)),a.gzindex=0,a.status=69;else if(At(a,0),At(a,0),At(a,0),At(a,0),At(a,0),At(a,9===a.level?2:a.strategy>=ot||a.level<2?4:0),At(a,3),a.status=mt,xt(t),0!==a.pending)return a.last_flush=-1,tt;if(69===a.status){if(a.gzhead.extra){for(var r=a.pending,s=(65535&a.gzhead.extra.length)-a.gzindex;a.pending+s>a.pending_buf_size;){var o=a.pending_buf_size-a.pending;if(a.pending_buf.set(a.gzhead.extra.subarray(a.gzindex,a.gzindex+o),a.pending),a.pending=a.pending_buf_size,a.gzhead.hcrc&&a.pending>r&&(t.adler=H(t.adler,a.pending_buf,a.pending-r,r)),a.gzindex+=o,xt(t),0!==a.pending)return a.last_flush=-1,tt;r=0,s-=o}var l=new Uint8Array(a.gzhead.extra);a.pending_buf.set(l.subarray(a.gzindex,a.gzindex+s),a.pending),a.pending+=s,a.gzhead.hcrc&&a.pending>r&&(t.adler=H(t.adler,a.pending_buf,a.pending-r,r)),a.gzindex=0}a.status=73}if(73===a.status){if(a.gzhead.name){var h,d=a.pending;do{if(a.pending===a.pending_buf_size){if(a.gzhead.hcrc&&a.pending>d&&(t.adler=H(t.adler,a.pending_buf,a.pending-d,d)),xt(t),0!==a.pending)return a.last_flush=-1,tt;d=0}h=a.gzindex<a.gzhead.name.length?255&a.gzhead.name.charCodeAt(a.gzindex++):0,At(a,h)}while(0!==h);a.gzhead.hcrc&&a.pending>d&&(t.adler=H(t.adler,a.pending_buf,a.pending-d,d)),a.gzindex=0}a.status=91}if(91===a.status){if(a.gzhead.comment){var _,f=a.pending;do{if(a.pending===a.pending_buf_size){if(a.gzhead.hcrc&&a.pending>f&&(t.adler=H(t.adler,a.pending_buf,a.pending-f,f)),xt(t),0!==a.pending)return a.last_flush=-1,tt;f=0}_=a.gzindex<a.gzhead.comment.length?255&a.gzhead.comment.charCodeAt(a.gzindex++):0,At(a,_)}while(0!==_);a.gzhead.hcrc&&a.pending>f&&(t.adler=H(t.adler,a.pending_buf,a.pending-f,f))}a.status=103}if(103===a.status){if(a.gzhead.hcrc){if(a.pending+2>a.pending_buf_size&&(xt(t),0!==a.pending))return a.last_flush=-1,tt;At(a,255&t.adler),At(a,t.adler>>8&255),t.adler=0}if(a.status=mt,xt(t),0!==a.pending)return a.last_flush=-1,tt}if(0!==t.avail_in||0!==a.lookahead||e!==q&&a.status!==bt){var u=0===a.level?Ut(a,e):a.strategy===ot?function(t,e){for(var a;;){if(0===t.lookahead&&(St(t),0===t.lookahead)){if(e===q)return 1;break}if(t.match_length=0,a=X(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++,a&&(zt(t,!1),0===t.strm.avail_out))return 1}return t.insert=0,e===V?(zt(t,!0),0===t.strm.avail_out?3:4):t.sym_next&&(zt(t,!1),0===t.strm.avail_out)?1:2}(a,e):a.strategy===lt?function(t,e){for(var a,n,i,r,s=t.window;;){if(t.lookahead<=ut){if(St(t),t.lookahead<=ut&&e===q)return 1;if(0===t.lookahead)break}if(t.match_length=0,t.lookahead>=3&&t.strstart>0&&(n=s[i=t.strstart-1])===s[++i]&&n===s[++i]&&n===s[++i]){r=t.strstart+ut;do{}while(n===s[++i]&&n===s[++i]&&n===s[++i]&&n===s[++i]&&n===s[++i]&&n===s[++i]&&n===s[++i]&&n===s[++i]&&i<r);t.match_length=ut-(r-i),t.match_length>t.lookahead&&(t.match_length=t.lookahead)}if(t.match_length>=3?(a=X(t,1,t.match_length-3),t.lookahead-=t.match_length,t.strstart+=t.match_length,t.match_length=0):(a=X(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++),a&&(zt(t,!1),0===t.strm.avail_out))return 1}return t.insert=0,e===V?(zt(t,!0),0===t.strm.avail_out?3:4):t.sym_next&&(zt(t,!1),0===t.strm.avail_out)?1:2}(a,e):It[a.level].func(a,e);if(3!==u&&4!==u||(a.status=bt),1===u||3===u)return 0===t.avail_out&&(a.last_flush=-1),tt;if(2===u&&(e===J?W(a):e!==$&&(Y(a,0,0,!1),e===Q&&(vt(a.head),0===a.lookahead&&(a.strstart=0,a.block_start=0,a.insert=0))),xt(t),0===t.avail_out))return a.last_flush=-1,tt}return e!==V?tt:a.wrap<=0?et:(2===a.wrap?(At(a,255&t.adler),At(a,t.adler>>8&255),At(a,t.adler>>16&255),At(a,t.adler>>24&255),At(a,255&t.total_in),At(a,t.total_in>>8&255),At(a,t.total_in>>16&255),At(a,t.total_in>>24&255)):(Et(a,t.adler>>>16),Et(a,65535&t.adler)),xt(t),a.wrap>0&&(a.wrap=-a.wrap),0!==a.pending?tt:et)},deflateEnd:function(t){if(Lt(t))return at;var e=t.state.status;return t.state=null,e===mt?gt(t,nt):tt},deflateSetDictionary:function(t,e){var a=e.length;if(Lt(t))return at;var n=t.state,i=n.wrap;if(2===i||1===i&&n.status!==wt||n.lookahead)return at;if(1===i&&(t.adler=C(t.adler,e,a,0)),n.wrap=0,a>=n.w_size){0===i&&(vt(n.head),n.strstart=0,n.block_start=0,n.insert=0);var r=new Uint8Array(n.w_size);r.set(e.subarray(a-n.w_size,a),0),e=r,a=n.w_size}var s=t.avail_in,o=t.next_in,l=t.input;for(t.avail_in=a,t.next_in=0,t.input=e,St(n);n.lookahead>=3;){var h=n.strstart,d=n.lookahead-2;do{n.ins_h=yt(n,n.ins_h,n.window[h+3-1]),n.prev[h&n.w_mask]=n.head[n.ins_h],n.head[n.ins_h]=h,h++}while(--d);n.strstart=h,n.lookahead=2,St(n)}return n.strstart+=n.lookahead,n.block_start=n.strstart,n.insert=n.lookahead,n.lookahead=0,n.match_length=n.prev_length=2,n.match_available=0,t.next_in=o,t.input=l,t.avail_in=s,n.wrap=i,tt},deflateInfo:"pako deflate (from Nodeca project)"};function Ht(t){return Ht="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ht(t)}var jt=function(t,e){return Object.prototype.hasOwnProperty.call(t,e)},Kt=function(t){for(var e=Array.prototype.slice.call(arguments,1);e.length;){var a=e.shift();if(a){if("object"!==Ht(a))throw new TypeError(a+"must be non-object");for(var n in a)jt(a,n)&&(t[n]=a[n])}}return t},Pt=function(t){for(var e=0,a=0,n=t.length;a<n;a++)e+=t[a].length;for(var i=new Uint8Array(e),r=0,s=0,o=t.length;r<o;r++){var l=t[r];i.set(l,s),s+=l.length}return i},Yt=!0;try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(t){Yt=!1}for(var Gt=new Uint8Array(256),Xt=0;Xt<256;Xt++)Gt[Xt]=Xt>=252?6:Xt>=248?5:Xt>=240?4:Xt>=224?3:Xt>=192?2:1;Gt[254]=Gt[254]=1;var Wt=function(t){if("function"==typeof TextEncoder&&TextEncoder.prototype.encode)return(new TextEncoder).encode(t);var e,a,n,i,r,s=t.length,o=0;for(i=0;i<s;i++)55296==(64512&(a=t.charCodeAt(i)))&&i+1<s&&56320==(64512&(n=t.charCodeAt(i+1)))&&(a=65536+(a-55296<<10)+(n-56320),i++),o+=a<128?1:a<2048?2:a<65536?3:4;for(e=new Uint8Array(o),r=0,i=0;r<o;i++)55296==(64512&(a=t.charCodeAt(i)))&&i+1<s&&56320==(64512&(n=t.charCodeAt(i+1)))&&(a=65536+(a-55296<<10)+(n-56320),i++),a<128?e[r++]=a:a<2048?(e[r++]=192|a>>>6,e[r++]=128|63&a):a<65536?(e[r++]=224|a>>>12,e[r++]=128|a>>>6&63,e[r++]=128|63&a):(e[r++]=240|a>>>18,e[r++]=128|a>>>12&63,e[r++]=128|a>>>6&63,e[r++]=128|63&a);return e},qt=function(t,e){var a,n,i=e||t.length;if("function"==typeof TextDecoder&&TextDecoder.prototype.decode)return(new TextDecoder).decode(t.subarray(0,e));var r=new Array(2*i);for(n=0,a=0;a<i;){var s=t[a++];if(s<128)r[n++]=s;else{var o=Gt[s];if(o>4)r[n++]=65533,a+=o-1;else{for(s&=2===o?31:3===o?15:7;o>1&&a<i;)s=s<<6|63&t[a++],o--;o>1?r[n++]=65533:s<65536?r[n++]=s:(s-=65536,r[n++]=55296|s>>10&1023,r[n++]=56320|1023&s)}}}return function(t,e){if(e<65534&&t.subarray&&Yt)return String.fromCharCode.apply(null,t.length===e?t:t.subarray(0,e));for(var a="",n=0;n<e;n++)a+=String.fromCharCode(t[n]);return a}(r,n)},Jt=function(t,e){(e=e||t.length)>t.length&&(e=t.length);for(var a=e-1;a>=0&&128==(192&t[a]);)a--;return a<0||0===a?e:a+Gt[t[a]]>e?a:e};var Qt=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0},Vt=Object.prototype.toString,$t=K.Z_NO_FLUSH,te=K.Z_SYNC_FLUSH,ee=K.Z_FULL_FLUSH,ae=K.Z_FINISH,ne=K.Z_OK,ie=K.Z_STREAM_END,re=K.Z_DEFAULT_COMPRESSION,se=K.Z_DEFAULT_STRATEGY,oe=K.Z_DEFLATED;function le(t){this.options=Kt({level:re,method:oe,chunkSize:16384,windowBits:15,memLevel:8,strategy:se},t||{});var e=this.options;e.raw&&e.windowBits>0?e.windowBits=-e.windowBits:e.gzip&&e.windowBits>0&&e.windowBits<16&&(e.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new Qt,this.strm.avail_out=0;var a=Mt.deflateInit2(this.strm,e.level,e.method,e.windowBits,e.memLevel,e.strategy);if(a!==ne)throw new Error(j[a]);if(e.header&&Mt.deflateSetHeader(this.strm,e.header),e.dictionary){var n;if(n="string"==typeof e.dictionary?Wt(e.dictionary):"[object ArrayBuffer]"===Vt.call(e.dictionary)?new Uint8Array(e.dictionary):e.dictionary,(a=Mt.deflateSetDictionary(this.strm,n))!==ne)throw new Error(j[a]);this._dict_set=!0}}function he(t,e){var a=new le(e);if(a.push(t,!0),a.err)throw a.msg||j[a.err];return a.result}le.prototype.push=function(t,e){var a,n,i=this.strm,r=this.options.chunkSize;if(this.ended)return!1;for(n=e===~~e?e:!0===e?ae:$t,"string"==typeof t?i.input=Wt(t):"[object ArrayBuffer]"===Vt.call(t)?i.input=new Uint8Array(t):i.input=t,i.next_in=0,i.avail_in=i.input.length;;)if(0===i.avail_out&&(i.output=new Uint8Array(r),i.next_out=0,i.avail_out=r),(n===te||n===ee)&&i.avail_out<=6)this.onData(i.output.subarray(0,i.next_out)),i.avail_out=0;else{if((a=Mt.deflate(i,n))===ie)return i.next_out>0&&this.onData(i.output.subarray(0,i.next_out)),a=Mt.deflateEnd(this.strm),this.onEnd(a),this.ended=!0,a===ne;if(0!==i.avail_out){if(n>0&&i.next_out>0)this.onData(i.output.subarray(0,i.next_out)),i.avail_out=0;else if(0===i.avail_in)break}else this.onData(i.output)}return!0},le.prototype.onData=function(t){this.chunks.push(t)},le.prototype.onEnd=function(t){t===ne&&(this.result=Pt(this.chunks)),this.chunks=[],this.err=t,this.msg=this.strm.msg};var de={Deflate:le,deflate:he,deflateRaw:function(t,e){return(e=e||{}).raw=!0,he(t,e)},gzip:function(t,e){return(e=e||{}).gzip=!0,he(t,e)},constants:K},_e=16209,fe=function(t,e){var a,n,i,r,s,o,l,h,d,_,f,u,c,w,m,b,g,p,v,k,y,x,z,A,E=t.state;a=t.next_in,z=t.input,n=a+(t.avail_in-5),i=t.next_out,A=t.output,r=i-(e-t.avail_out),s=i+(t.avail_out-257),o=E.dmax,l=E.wsize,h=E.whave,d=E.wnext,_=E.window,f=E.hold,u=E.bits,c=E.lencode,w=E.distcode,m=(1<<E.lenbits)-1,b=(1<<E.distbits)-1;t:do{u<15&&(f+=z[a++]<<u,u+=8,f+=z[a++]<<u,u+=8),g=c[f&m];e:for(;;){if(f>>>=p=g>>>24,u-=p,0===(p=g>>>16&255))A[i++]=65535&g;else{if(!(16&p)){if(0==(64&p)){g=c[(65535&g)+(f&(1<<p)-1)];continue e}if(32&p){E.mode=16191;break t}t.msg="invalid literal/length code",E.mode=_e;break t}v=65535&g,(p&=15)&&(u<p&&(f+=z[a++]<<u,u+=8),v+=f&(1<<p)-1,f>>>=p,u-=p),u<15&&(f+=z[a++]<<u,u+=8,f+=z[a++]<<u,u+=8),g=w[f&b];a:for(;;){if(f>>>=p=g>>>24,u-=p,!(16&(p=g>>>16&255))){if(0==(64&p)){g=w[(65535&g)+(f&(1<<p)-1)];continue a}t.msg="invalid distance code",E.mode=_e;break t}if(k=65535&g,u<(p&=15)&&(f+=z[a++]<<u,(u+=8)<p&&(f+=z[a++]<<u,u+=8)),(k+=f&(1<<p)-1)>o){t.msg="invalid distance too far back",E.mode=_e;break t}if(f>>>=p,u-=p,k>(p=i-r)){if((p=k-p)>h&&E.sane){t.msg="invalid distance too far back",E.mode=_e;break t}if(y=0,x=_,0===d){if(y+=l-p,p<v){v-=p;do{A[i++]=_[y++]}while(--p);y=i-k,x=A}}else if(d<p){if(y+=l+d-p,(p-=d)<v){v-=p;do{A[i++]=_[y++]}while(--p);if(y=0,d<v){v-=p=d;do{A[i++]=_[y++]}while(--p);y=i-k,x=A}}}else if(y+=d-p,p<v){v-=p;do{A[i++]=_[y++]}while(--p);y=i-k,x=A}for(;v>2;)A[i++]=x[y++],A[i++]=x[y++],A[i++]=x[y++],v-=3;v&&(A[i++]=x[y++],v>1&&(A[i++]=x[y++]))}else{y=i-k;do{A[i++]=A[y++],A[i++]=A[y++],A[i++]=A[y++],v-=3}while(v>2);v&&(A[i++]=A[y++],v>1&&(A[i++]=A[y++]))}break}}break}}while(a<n&&i<s);a-=v=u>>3,f&=(1<<(u-=v<<3))-1,t.next_in=a,t.next_out=i,t.avail_in=a<n?n-a+5:5-(a-n),t.avail_out=i<s?s-i+257:257-(i-s),E.hold=f,E.bits=u},ue=15,ce=new Uint16Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0]),we=new Uint8Array([16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78]),me=new Uint16Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0]),be=new Uint8Array([16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64]),ge=function(t,e,a,n,i,r,s,o){var l,h,d,_,f,u,c,w,m,b=o.bits,g=0,p=0,v=0,k=0,y=0,x=0,z=0,A=0,E=0,R=0,Z=null,S=new Uint16Array(16),U=new Uint16Array(16),D=null;for(g=0;g<=ue;g++)S[g]=0;for(p=0;p<n;p++)S[e[a+p]]++;for(y=b,k=ue;k>=1&&0===S[k];k--);if(y>k&&(y=k),0===k)return i[r++]=20971520,i[r++]=20971520,o.bits=1,0;for(v=1;v<k&&0===S[v];v++);for(y<v&&(y=v),A=1,g=1;g<=ue;g++)if(A<<=1,(A-=S[g])<0)return-1;if(A>0&&(0===t||1!==k))return-1;for(U[1]=0,g=1;g<ue;g++)U[g+1]=U[g]+S[g];for(p=0;p<n;p++)0!==e[a+p]&&(s[U[e[a+p]]++]=p);if(0===t?(Z=D=s,u=20):1===t?(Z=ce,D=we,u=257):(Z=me,D=be,u=0),R=0,p=0,g=v,f=r,x=y,z=0,d=-1,_=(E=1<<y)-1,1===t&&E>852||2===t&&E>592)return 1;for(;;){c=g-z,s[p]+1<u?(w=0,m=s[p]):s[p]>=u?(w=D[s[p]-u],m=Z[s[p]-u]):(w=96,m=0),l=1<<g-z,v=h=1<<x;do{i[f+(R>>z)+(h-=l)]=c<<24|w<<16|m|0}while(0!==h);for(l=1<<g-1;R&l;)l>>=1;if(0!==l?(R&=l-1,R+=l):R=0,p++,0==--S[g]){if(g===k)break;g=e[a+s[p]]}if(g>y&&(R&_)!==d){for(0===z&&(z=y),f+=v,A=1<<(x=g-z);x+z<k&&!((A-=S[x+z])<=0);)x++,A<<=1;if(E+=1<<x,1===t&&E>852||2===t&&E>592)return 1;i[d=R&_]=y<<24|x<<16|f-r|0}}return 0!==R&&(i[f+R]=g-z<<24|64<<16|0),o.bits=y,0},pe=K.Z_FINISH,ve=K.Z_BLOCK,ke=K.Z_TREES,ye=K.Z_OK,xe=K.Z_STREAM_END,ze=K.Z_NEED_DICT,Ae=K.Z_STREAM_ERROR,Ee=K.Z_DATA_ERROR,Re=K.Z_MEM_ERROR,Ze=K.Z_BUF_ERROR,Se=K.Z_DEFLATED,Ue=16180,De=16190,Te=16191,Oe=16192,Ie=16194,Fe=16199,Le=16200,Ne=16206,Be=16209,Ce=function(t){return(t>>>24&255)+(t>>>8&65280)+((65280&t)<<8)+((255&t)<<24)};function Me(){this.strm=null,this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new Uint16Array(320),this.work=new Uint16Array(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}var He,je,Ke=function(t){if(!t)return 1;var e=t.state;return!e||e.strm!==t||e.mode<Ue||e.mode>16211?1:0},Pe=function(t){if(Ke(t))return Ae;var e=t.state;return t.total_in=t.total_out=e.total=0,t.msg="",e.wrap&&(t.adler=1&e.wrap),e.mode=Ue,e.last=0,e.havedict=0,e.flags=-1,e.dmax=32768,e.head=null,e.hold=0,e.bits=0,e.lencode=e.lendyn=new Int32Array(852),e.distcode=e.distdyn=new Int32Array(592),e.sane=1,e.back=-1,ye},Ye=function(t){if(Ke(t))return Ae;var e=t.state;return e.wsize=0,e.whave=0,e.wnext=0,Pe(t)},Ge=function(t,e){var a;if(Ke(t))return Ae;var n=t.state;return e<0?(a=0,e=-e):(a=5+(e>>4),e<48&&(e&=15)),e&&(e<8||e>15)?Ae:(null!==n.window&&n.wbits!==e&&(n.window=null),n.wrap=a,n.wbits=e,Ye(t))},Xe=function(t,e){if(!t)return Ae;var a=new Me;t.state=a,a.strm=t,a.window=null,a.mode=Ue;var n=Ge(t,e);return n!==ye&&(t.state=null),n},We=!0,qe=function(t){if(We){He=new Int32Array(512),je=new Int32Array(32);for(var e=0;e<144;)t.lens[e++]=8;for(;e<256;)t.lens[e++]=9;for(;e<280;)t.lens[e++]=7;for(;e<288;)t.lens[e++]=8;for(ge(1,t.lens,0,288,He,0,t.work,{bits:9}),e=0;e<32;)t.lens[e++]=5;ge(2,t.lens,0,32,je,0,t.work,{bits:5}),We=!1}t.lencode=He,t.lenbits=9,t.distcode=je,t.distbits=5},Je=function(t,e,a,n){var i,r=t.state;return null===r.window&&(r.wsize=1<<r.wbits,r.wnext=0,r.whave=0,r.window=new Uint8Array(r.wsize)),n>=r.wsize?(r.window.set(e.subarray(a-r.wsize,a),0),r.wnext=0,r.whave=r.wsize):((i=r.wsize-r.wnext)>n&&(i=n),r.window.set(e.subarray(a-n,a-n+i),r.wnext),(n-=i)?(r.window.set(e.subarray(a-n,a),0),r.wnext=n,r.whave=r.wsize):(r.wnext+=i,r.wnext===r.wsize&&(r.wnext=0),r.whave<r.wsize&&(r.whave+=i))),0},Qe={inflateReset:Ye,inflateReset2:Ge,inflateResetKeep:Pe,inflateInit:function(t){return Xe(t,15)},inflateInit2:Xe,inflate:function(t,e){var a,n,i,r,s,o,l,h,d,_,f,u,c,w,m,b,g,p,v,k,y,x,z,A,E=0,R=new Uint8Array(4),Z=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);if(Ke(t)||!t.output||!t.input&&0!==t.avail_in)return Ae;(a=t.state).mode===Te&&(a.mode=Oe),s=t.next_out,i=t.output,l=t.avail_out,r=t.next_in,n=t.input,o=t.avail_in,h=a.hold,d=a.bits,_=o,f=l,x=ye;t:for(;;)switch(a.mode){case Ue:if(0===a.wrap){a.mode=Oe;break}for(;d<16;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(2&a.wrap&&35615===h){0===a.wbits&&(a.wbits=15),a.check=0,R[0]=255&h,R[1]=h>>>8&255,a.check=H(a.check,R,2,0),h=0,d=0,a.mode=16181;break}if(a.head&&(a.head.done=!1),!(1&a.wrap)||(((255&h)<<8)+(h>>8))%31){t.msg="incorrect header check",a.mode=Be;break}if((15&h)!==Se){t.msg="unknown compression method",a.mode=Be;break}if(d-=4,y=8+(15&(h>>>=4)),0===a.wbits&&(a.wbits=y),y>15||y>a.wbits){t.msg="invalid window size",a.mode=Be;break}a.dmax=1<<a.wbits,a.flags=0,t.adler=a.check=1,a.mode=512&h?16189:Te,h=0,d=0;break;case 16181:for(;d<16;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(a.flags=h,(255&a.flags)!==Se){t.msg="unknown compression method",a.mode=Be;break}if(57344&a.flags){t.msg="unknown header flags set",a.mode=Be;break}a.head&&(a.head.text=h>>8&1),512&a.flags&&4&a.wrap&&(R[0]=255&h,R[1]=h>>>8&255,a.check=H(a.check,R,2,0)),h=0,d=0,a.mode=16182;case 16182:for(;d<32;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}a.head&&(a.head.time=h),512&a.flags&&4&a.wrap&&(R[0]=255&h,R[1]=h>>>8&255,R[2]=h>>>16&255,R[3]=h>>>24&255,a.check=H(a.check,R,4,0)),h=0,d=0,a.mode=16183;case 16183:for(;d<16;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}a.head&&(a.head.xflags=255&h,a.head.os=h>>8),512&a.flags&&4&a.wrap&&(R[0]=255&h,R[1]=h>>>8&255,a.check=H(a.check,R,2,0)),h=0,d=0,a.mode=16184;case 16184:if(1024&a.flags){for(;d<16;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}a.length=h,a.head&&(a.head.extra_len=h),512&a.flags&&4&a.wrap&&(R[0]=255&h,R[1]=h>>>8&255,a.check=H(a.check,R,2,0)),h=0,d=0}else a.head&&(a.head.extra=null);a.mode=16185;case 16185:if(1024&a.flags&&((u=a.length)>o&&(u=o),u&&(a.head&&(y=a.head.extra_len-a.length,a.head.extra||(a.head.extra=new Uint8Array(a.head.extra_len)),a.head.extra.set(n.subarray(r,r+u),y)),512&a.flags&&4&a.wrap&&(a.check=H(a.check,n,u,r)),o-=u,r+=u,a.length-=u),a.length))break t;a.length=0,a.mode=16186;case 16186:if(2048&a.flags){if(0===o)break t;u=0;do{y=n[r+u++],a.head&&y&&a.length<65536&&(a.head.name+=String.fromCharCode(y))}while(y&&u<o);if(512&a.flags&&4&a.wrap&&(a.check=H(a.check,n,u,r)),o-=u,r+=u,y)break t}else a.head&&(a.head.name=null);a.length=0,a.mode=16187;case 16187:if(4096&a.flags){if(0===o)break t;u=0;do{y=n[r+u++],a.head&&y&&a.length<65536&&(a.head.comment+=String.fromCharCode(y))}while(y&&u<o);if(512&a.flags&&4&a.wrap&&(a.check=H(a.check,n,u,r)),o-=u,r+=u,y)break t}else a.head&&(a.head.comment=null);a.mode=16188;case 16188:if(512&a.flags){for(;d<16;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(4&a.wrap&&h!==(65535&a.check)){t.msg="header crc mismatch",a.mode=Be;break}h=0,d=0}a.head&&(a.head.hcrc=a.flags>>9&1,a.head.done=!0),t.adler=a.check=0,a.mode=Te;break;case 16189:for(;d<32;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}t.adler=a.check=Ce(h),h=0,d=0,a.mode=De;case De:if(0===a.havedict)return t.next_out=s,t.avail_out=l,t.next_in=r,t.avail_in=o,a.hold=h,a.bits=d,ze;t.adler=a.check=1,a.mode=Te;case Te:if(e===ve||e===ke)break t;case Oe:if(a.last){h>>>=7&d,d-=7&d,a.mode=Ne;break}for(;d<3;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}switch(a.last=1&h,d-=1,3&(h>>>=1)){case 0:a.mode=16193;break;case 1:if(qe(a),a.mode=Fe,e===ke){h>>>=2,d-=2;break t}break;case 2:a.mode=16196;break;case 3:t.msg="invalid block type",a.mode=Be}h>>>=2,d-=2;break;case 16193:for(h>>>=7&d,d-=7&d;d<32;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if((65535&h)!=(h>>>16^65535)){t.msg="invalid stored block lengths",a.mode=Be;break}if(a.length=65535&h,h=0,d=0,a.mode=Ie,e===ke)break t;case Ie:a.mode=16195;case 16195:if(u=a.length){if(u>o&&(u=o),u>l&&(u=l),0===u)break t;i.set(n.subarray(r,r+u),s),o-=u,r+=u,l-=u,s+=u,a.length-=u;break}a.mode=Te;break;case 16196:for(;d<14;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(a.nlen=257+(31&h),h>>>=5,d-=5,a.ndist=1+(31&h),h>>>=5,d-=5,a.ncode=4+(15&h),h>>>=4,d-=4,a.nlen>286||a.ndist>30){t.msg="too many length or distance symbols",a.mode=Be;break}a.have=0,a.mode=16197;case 16197:for(;a.have<a.ncode;){for(;d<3;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}a.lens[Z[a.have++]]=7&h,h>>>=3,d-=3}for(;a.have<19;)a.lens[Z[a.have++]]=0;if(a.lencode=a.lendyn,a.lenbits=7,z={bits:a.lenbits},x=ge(0,a.lens,0,19,a.lencode,0,a.work,z),a.lenbits=z.bits,x){t.msg="invalid code lengths set",a.mode=Be;break}a.have=0,a.mode=16198;case 16198:for(;a.have<a.nlen+a.ndist;){for(;b=(E=a.lencode[h&(1<<a.lenbits)-1])>>>16&255,g=65535&E,!((m=E>>>24)<=d);){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(g<16)h>>>=m,d-=m,a.lens[a.have++]=g;else{if(16===g){for(A=m+2;d<A;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(h>>>=m,d-=m,0===a.have){t.msg="invalid bit length repeat",a.mode=Be;break}y=a.lens[a.have-1],u=3+(3&h),h>>>=2,d-=2}else if(17===g){for(A=m+3;d<A;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}d-=m,y=0,u=3+(7&(h>>>=m)),h>>>=3,d-=3}else{for(A=m+7;d<A;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}d-=m,y=0,u=11+(127&(h>>>=m)),h>>>=7,d-=7}if(a.have+u>a.nlen+a.ndist){t.msg="invalid bit length repeat",a.mode=Be;break}for(;u--;)a.lens[a.have++]=y}}if(a.mode===Be)break;if(0===a.lens[256]){t.msg="invalid code -- missing end-of-block",a.mode=Be;break}if(a.lenbits=9,z={bits:a.lenbits},x=ge(1,a.lens,0,a.nlen,a.lencode,0,a.work,z),a.lenbits=z.bits,x){t.msg="invalid literal/lengths set",a.mode=Be;break}if(a.distbits=6,a.distcode=a.distdyn,z={bits:a.distbits},x=ge(2,a.lens,a.nlen,a.ndist,a.distcode,0,a.work,z),a.distbits=z.bits,x){t.msg="invalid distances set",a.mode=Be;break}if(a.mode=Fe,e===ke)break t;case Fe:a.mode=Le;case Le:if(o>=6&&l>=258){t.next_out=s,t.avail_out=l,t.next_in=r,t.avail_in=o,a.hold=h,a.bits=d,fe(t,f),s=t.next_out,i=t.output,l=t.avail_out,r=t.next_in,n=t.input,o=t.avail_in,h=a.hold,d=a.bits,a.mode===Te&&(a.back=-1);break}for(a.back=0;b=(E=a.lencode[h&(1<<a.lenbits)-1])>>>16&255,g=65535&E,!((m=E>>>24)<=d);){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(b&&0==(240&b)){for(p=m,v=b,k=g;b=(E=a.lencode[k+((h&(1<<p+v)-1)>>p)])>>>16&255,g=65535&E,!(p+(m=E>>>24)<=d);){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}h>>>=p,d-=p,a.back+=p}if(h>>>=m,d-=m,a.back+=m,a.length=g,0===b){a.mode=16205;break}if(32&b){a.back=-1,a.mode=Te;break}if(64&b){t.msg="invalid literal/length code",a.mode=Be;break}a.extra=15&b,a.mode=16201;case 16201:if(a.extra){for(A=a.extra;d<A;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}a.length+=h&(1<<a.extra)-1,h>>>=a.extra,d-=a.extra,a.back+=a.extra}a.was=a.length,a.mode=16202;case 16202:for(;b=(E=a.distcode[h&(1<<a.distbits)-1])>>>16&255,g=65535&E,!((m=E>>>24)<=d);){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(0==(240&b)){for(p=m,v=b,k=g;b=(E=a.distcode[k+((h&(1<<p+v)-1)>>p)])>>>16&255,g=65535&E,!(p+(m=E>>>24)<=d);){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}h>>>=p,d-=p,a.back+=p}if(h>>>=m,d-=m,a.back+=m,64&b){t.msg="invalid distance code",a.mode=Be;break}a.offset=g,a.extra=15&b,a.mode=16203;case 16203:if(a.extra){for(A=a.extra;d<A;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}a.offset+=h&(1<<a.extra)-1,h>>>=a.extra,d-=a.extra,a.back+=a.extra}if(a.offset>a.dmax){t.msg="invalid distance too far back",a.mode=Be;break}a.mode=16204;case 16204:if(0===l)break t;if(u=f-l,a.offset>u){if((u=a.offset-u)>a.whave&&a.sane){t.msg="invalid distance too far back",a.mode=Be;break}u>a.wnext?(u-=a.wnext,c=a.wsize-u):c=a.wnext-u,u>a.length&&(u=a.length),w=a.window}else w=i,c=s-a.offset,u=a.length;u>l&&(u=l),l-=u,a.length-=u;do{i[s++]=w[c++]}while(--u);0===a.length&&(a.mode=Le);break;case 16205:if(0===l)break t;i[s++]=a.length,l--,a.mode=Le;break;case Ne:if(a.wrap){for(;d<32;){if(0===o)break t;o--,h|=n[r++]<<d,d+=8}if(f-=l,t.total_out+=f,a.total+=f,4&a.wrap&&f&&(t.adler=a.check=a.flags?H(a.check,i,f,s-f):C(a.check,i,f,s-f)),f=l,4&a.wrap&&(a.flags?h:Ce(h))!==a.check){t.msg="incorrect data check",a.mode=Be;break}h=0,d=0}a.mode=16207;case 16207:if(a.wrap&&a.flags){for(;d<32;){if(0===o)break t;o--,h+=n[r++]<<d,d+=8}if(4&a.wrap&&h!==(4294967295&a.total)){t.msg="incorrect length check",a.mode=Be;break}h=0,d=0}a.mode=16208;case 16208:x=xe;break t;case Be:x=Ee;break t;case 16210:return Re;default:return Ae}return t.next_out=s,t.avail_out=l,t.next_in=r,t.avail_in=o,a.hold=h,a.bits=d,(a.wsize||f!==t.avail_out&&a.mode<Be&&(a.mode<Ne||e!==pe))&&Je(t,t.output,t.next_out,f-t.avail_out),_-=t.avail_in,f-=t.avail_out,t.total_in+=_,t.total_out+=f,a.total+=f,4&a.wrap&&f&&(t.adler=a.check=a.flags?H(a.check,i,f,t.next_out-f):C(a.check,i,f,t.next_out-f)),t.data_type=a.bits+(a.last?64:0)+(a.mode===Te?128:0)+(a.mode===Fe||a.mode===Ie?256:0),(0===_&&0===f||e===pe)&&x===ye&&(x=Ze),x},inflateEnd:function(t){if(Ke(t))return Ae;var e=t.state;return e.window&&(e.window=null),t.state=null,ye},inflateGetHeader:function(t,e){if(Ke(t))return Ae;var a=t.state;return 0==(2&a.wrap)?Ae:(a.head=e,e.done=!1,ye)},inflateSetDictionary:function(t,e){var a,n=e.length;return Ke(t)||0!==(a=t.state).wrap&&a.mode!==De?Ae:a.mode===De&&C(1,e,n,0)!==a.check?Ee:Je(t,e,n,n)?(a.mode=16210,Re):(a.havedict=1,ye)},inflateInfo:"pako inflate (from Nodeca project)"};var Ve=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1},$e=Object.prototype.toString,ta=K.Z_NO_FLUSH,ea=K.Z_FINISH,aa=K.Z_OK,na=K.Z_STREAM_END,ia=K.Z_NEED_DICT,ra=K.Z_STREAM_ERROR,sa=K.Z_DATA_ERROR,oa=K.Z_MEM_ERROR;function la(t){this.options=Kt({chunkSize:65536,windowBits:15,to:""},t||{});var e=this.options;e.raw&&e.windowBits>=0&&e.windowBits<16&&(e.windowBits=-e.windowBits,0===e.windowBits&&(e.windowBits=-15)),!(e.windowBits>=0&&e.windowBits<16)||t&&t.windowBits||(e.windowBits+=32),e.windowBits>15&&e.windowBits<48&&0==(15&e.windowBits)&&(e.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new Qt,this.strm.avail_out=0;var a=Qe.inflateInit2(this.strm,e.windowBits);if(a!==aa)throw new Error(j[a]);if(this.header=new Ve,Qe.inflateGetHeader(this.strm,this.header),e.dictionary&&("string"==typeof e.dictionary?e.dictionary=Wt(e.dictionary):"[object ArrayBuffer]"===$e.call(e.dictionary)&&(e.dictionary=new Uint8Array(e.dictionary)),e.raw&&(a=Qe.inflateSetDictionary(this.strm,e.dictionary))!==aa))throw new Error(j[a])}function ha(t,e){var a=new la(e);if(a.push(t),a.err)throw a.msg||j[a.err];return a.result}la.prototype.push=function(t,e){var a,n,i,r=this.strm,s=this.options.chunkSize,o=this.options.dictionary;if(this.ended)return!1;for(n=e===~~e?e:!0===e?ea:ta,"[object ArrayBuffer]"===$e.call(t)?r.input=new Uint8Array(t):r.input=t,r.next_in=0,r.avail_in=r.input.length;;){for(0===r.avail_out&&(r.output=new Uint8Array(s),r.next_out=0,r.avail_out=s),(a=Qe.inflate(r,n))===ia&&o&&((a=Qe.inflateSetDictionary(r,o))===aa?a=Qe.inflate(r,n):a===sa&&(a=ia));r.avail_in>0&&a===na&&r.state.wrap>0&&0!==t[r.next_in];)Qe.inflateReset(r),a=Qe.inflate(r,n);switch(a){case ra:case sa:case ia:case oa:return this.onEnd(a),this.ended=!0,!1}if(i=r.avail_out,r.next_out&&(0===r.avail_out||a===na))if("string"===this.options.to){var l=Jt(r.output,r.next_out),h=r.next_out-l,d=qt(r.output,l);r.next_out=h,r.avail_out=s-h,h&&r.output.set(r.output.subarray(l,l+h),0),this.onData(d)}else this.onData(r.output.length===r.next_out?r.output:r.output.subarray(0,r.next_out));if(a!==aa||0!==i){if(a===na)return a=Qe.inflateEnd(this.strm),this.onEnd(a),this.ended=!0,!0;if(0===r.avail_in)break}}return!0},la.prototype.onData=function(t){this.chunks.push(t)},la.prototype.onEnd=function(t){t===aa&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=Pt(this.chunks)),this.chunks=[],this.err=t,this.msg=this.strm.msg};var da={Inflate:la,inflate:ha,inflateRaw:function(t,e){return(e=e||{}).raw=!0,ha(t,e)},ungzip:ha,constants:K},_a=de.Deflate,fa=de.deflate,ua=de.deflateRaw,ca=de.gzip,wa=da.Inflate,ma=da.inflate,ba=da.inflateRaw,ga=da.ungzip,pa=K,va={Deflate:_a,deflate:fa,deflateRaw:ua,gzip:ca,Inflate:wa,inflate:ma,inflateRaw:ba,ungzip:ga,constants:pa};t.Deflate=_a,t.Inflate=wa,t.constants=pa,t.default=va,t.deflate=fa,t.deflateRaw=ua,t.gzip=ca,t.inflate=ma,t.inflateRaw=ba,t.ungzip=ga,Object.defineProperty(t,"__esModule",{value:!0})}));

        return exports;
    })();

    var deflateRaw = pako && pako.deflateRaw;
    var inflateRaw = pako && pako.inflateRaw;
    var HAS_Z = (typeof deflateRaw === 'function' && typeof inflateRaw === 'function');

    var S = window.Storage && window.Storage.prototype;
    if (!S || typeof S.getItem !== 'function' || typeof S.setItem !== 'function') return;
    var rawGet = S.getItem, rawSet = S.setItem, rawDel = S.removeItem, rawClear = S.clear;

    // ═════════════════════════════════════════════════════════════════════════
    //  ۱) قالبِ فشردهٔ نسخهٔ قبلی (JQZ1) — خواندن همیشه؛ نوشتن فقط در «حالتِ قدیمی»
    //     (این بخش عیناً همان منطقِ نسخهٔ قبلیِ این فایل است.)
    // ═════════════════════════════════════════════════════════════════════════
    var MAGIC     = '\u0000JQZ1|';
    var THRESHOLD = 20000;
    var LEVEL     = 3;
    var BITS      = 15;
    var OFFSET    = 32;

    function pack(bytes) {
        var out = [], buf = 0, bits = 0, i, n = bytes.length;
        for (i = 0; i < n; i++) {
            buf = (buf << 8) | bytes[i]; bits += 8;
            while (bits >= BITS) { bits -= BITS; out.push(String.fromCharCode(OFFSET + ((buf >>> bits) & 32767))); }
            buf &= (1 << bits) - 1;
        }
        if (bits > 0) out.push(String.fromCharCode(OFFSET + ((buf << (BITS - bits)) & 32767)));
        var s = '', CH = 8192;
        for (i = 0; i < out.length; i += CH) s += out.slice(i, i + CH).join('');
        return s;
    }
    function unpack(str, byteLen) {
        var bytes = new Uint8Array(byteLen), buf = 0, bits = 0, o = 0, i, n = str.length;
        for (i = 0; i < n && o < byteLen; i++) {
            buf = (buf * 32768) + ((str.charCodeAt(i) - OFFSET) & 32767); bits += BITS;
            while (bits >= 8 && o < byteLen) {
                bits -= 8;
                bytes[o++] = Math.floor(buf / Math.pow(2, bits)) & 255;
                buf = buf % Math.pow(2, bits);
            }
        }
        return bytes;
    }
    function encode(plain) {
        var bytes = deflateRaw(plain, { level: LEVEL });
        return MAGIC + bytes.length + '|' + pack(bytes);
    }
    function decode(stored) {
        var i = stored.indexOf('|', MAGIC.length);
        if (i < 0) return null;
        var len = parseInt(stored.slice(MAGIC.length, i), 10);
        if (!(len >= 0)) return null;
        return inflateRaw(unpack(stored.slice(i + 1), len), { to: 'string' });
    }
    function isPacked(v) { return typeof v === 'string' && v.length > MAGIC.length && v.slice(0, MAGIC.length) === MAGIC; }
    function safeDecode(v) {
        if (!HAS_Z) return null;
        try { var p = decode(v); return (typeof p === 'string') ? p : null; } catch (e) { return null; }
    }

    var zcache = Object.create(null);
    function readPlain(key, v) {
        if (!isPacked(v)) return v;
        var c = zcache[key];
        if (c && c.stored === v) return c.plain;
        var plain = safeDecode(v);
        if (plain === null) return v;                          // هرگز داده را پنهان نکن
        zcache[key] = { stored: v, plain: plain };
        return plain;
    }
    // نوشتنِ «حالتِ قدیمی» — عیناً همان setItemِ نسخهٔ قبلی
    function legacySet(st, key, value) {
        var plain = (typeof value === 'string') ? value : String(value);
        if (st === LS && rawGet.call(st, key) === PTR) throw new Error(MSG_PTR_GUARD);
        if (!HAS_Z || plain.length < THRESHOLD) {
            delete zcache[key];
            return rawSet.call(st, key, plain);
        }
        var c = zcache[key];
        if (c && c.plain === plain && rawGet.call(st, key) === c.stored) return;
        var packed = null;
        try {
            packed = encode(plain);
            if (decode(packed) !== plain) packed = null;
        } catch (e) { packed = null; }
        if (packed === null || packed.length >= plain.length) {
            delete zcache[key];
            return rawSet.call(st, key, plain);
        }
        rawSet.call(st, key, packed);
        zcache[key] = { stored: packed, plain: plain };
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ۲) موتورِ IndexedDB
    // ═════════════════════════════════════════════════════════════════════════
    var PTR       = '\u0000APEXIDB1';      // نشانگرِ «مقدار در IndexedDB است»
    var DB_NAME   = 'apex_store';          // (پایگاهِ قدیمیِ «jouya_store» ربطی به این ندارد)
    var DB_VER    = 1;
    var IDB_MIN   = 8192;                  // مقدارِ کوچک‌تر از این در localStorage می‌ماند
    var OPEN_TIMEOUT = 20000;
    var MSG_PTR_GUARD = 'APEX: این کلید در IndexedDB است و این نسخهٔ صفحه نمی‌تواند روی آن بنویسد. برنامه را دوباره باز کنید.';

    // فقط index.htmlِ جدید (با بوتِ مرحله‌ای) این موتور را فعال می‌کند؛ اگر نسخهٔ قدیمیِ
    // صفحه (مثلاً از کشِ مرورگر) این فایل را بار کند، «حالتِ قدیمی» اجرا می‌شود.
    var BOOT = false;
    try {
        var _mt = document.querySelector('meta[name="apex-storage"]');
        BOOT = !!(_mt && _mt.getAttribute('content') === 'idb-v1');
    } catch (e) { BOOT = false; }

    var mode   = BOOT ? 'pending' : 'legacy';     // pending | idb | legacy | blocked
    var idb    = null;
    var mem    = Object.create(null);             // کلید → مقدار (فقط کلیدهای IndexedDB)
    var owned  = Object.create(null);             // کلید → true
    var early  = Object.create(null);             // نوشتن‌های پیش از آماده‌شدن
    var earlyOrder = [];
    var remoteEarly = [];
    var queue  = Object.create(null);             // صفِ نوشتن: کلید → {op, v, ptr, fp}
    var tqueue = [];                              // کلیدهایی که نشانهٔ انتقالشان باید پاک شود
    var queued = false, inflight = null, failures = 0, retryTimer = null;
    var waiters = [];
    var lastError = null;
    var earlyWarned = Object.create(null);
    var stats0 = { migrated: 0, lost: 0, recovered: 0, superseded: 0 };

    function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function keysOf(o) { var a = [], k; for (k in o) if (hasOwn(o, k)) a.push(k); return a; }
    function nextTick(fn) {
        try { Promise.resolve().then(fn); } catch (e) { setTimeout(fn, 0); }
    }

    // اثرِ انگشتِ یک رشته (برای تشخیصِ «کدام نسخه تازه‌تر است» پس از قطعِ ناگهانی)
    var imul = Math.imul || function (a, b) {
        var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
        return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
    };
    function fp(s) {
        if (s === null || s === undefined) return 'N';
        var h1 = 0x811c9dc5, h2 = 5381, i, c, n = s.length;
        for (i = 0; i < n; i++) {
            c = s.charCodeAt(i);
            h1 ^= c; h1 = imul(h1, 16777619);
            h2 = ((h2 << 5) + h2 + c) | 0;
        }
        return n + ':' + (h1 >>> 0).toString(36) + ':' + (h2 >>> 0).toString(36);
    }

    // ── پیام‌های کاربر (بدونِ وابستگی به script.js) ───────────────────────────
    function onBody(fn) {
        // عمداً با تایمر، نه DOMContentLoaded (آن رویداد تا پایانِ بوت نگه داشته می‌شود)
        if (document.body) { try { fn(); } catch (e) {} return; }
        setTimeout(function () { onBody(fn); }, 50);
    }
    function showBlock(title, text, allowContinue, onContinue) {
        onBody(function () {
            var old = document.getElementById('apex-store-block');
            if (old) old.parentNode.removeChild(old);
            var d = document.createElement('div');
            d.id = 'apex-store-block';
            d.setAttribute('style', 'position:fixed;inset:0;z-index:2147483600;background:#f8fafc;display:flex;' +
                'align-items:center;justify-content:center;direction:rtl;font-family:Vazirmatn,Tahoma,sans-serif;padding:16px;');
            var box = '<div style="max-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;' +
                'box-shadow:0 10px 30px rgba(15,23,42,.12);text-align:center;color:#1e293b">' +
                '<div style="font-weight:800;font-size:17px;margin-bottom:10px;color:#b91c1c">' + title + '</div>' +
                '<div style="font-size:14px;line-height:1.9;color:#334155">' + text + '</div>' +
                '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
                '<button id="apex-store-retry" style="background:#1e3a5f;color:#fff;border:0;border-radius:8px;padding:9px 18px;font:inherit;cursor:pointer">تلاشِ دوباره</button>' +
                (allowContinue ? '<button id="apex-store-cont" style="background:#fff;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer">ادامه بدونِ این اطلاعات</button>' : '') +
                '</div></div>';
            d.innerHTML = box;
            document.body.appendChild(d);
            try { document.documentElement.classList.remove('jouya-show-loader'); } catch (e) {}
            var r = document.getElementById('apex-store-retry');
            if (r) r.onclick = function () { try { location.reload(); } catch (e) {} };
            var c = document.getElementById('apex-store-cont');
            if (c && onContinue) c.onclick = function () {
                if (!window.confirm('اطلاعاتِ این بخش‌ها دیگر بازیابی نمی‌شود. مطمئن هستید؟')) return;
                try { d.parentNode.removeChild(d); } catch (e) {}
                onContinue();
            };
        });
    }
    var bannerShown = false;
    function showBanner(err) {
        if (bannerShown) return; bannerShown = true;
        onBody(function () {
            var b = document.getElementById('apex-store-banner');
            if (!b) {
                b = document.createElement('div');
                b.id = 'apex-store-banner';
                b.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483500;background:#b91c1c;color:#fff;' +
                    'direction:rtl;text-align:center;font-family:Vazirmatn,Tahoma,sans-serif;font-size:13px;padding:7px 12px;');
                document.body.appendChild(b);
            }
            var full = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message || '')));
            b.textContent = full
                ? 'فضای دیسکِ دستگاه پر است و آخرین تغییرات هنوز به‌صورتِ دائمی ذخیره نشده‌اند. کمی فضا آزاد کنید؛ برنامه را نبندید — ذخیره خودکار دوباره تلاش می‌شود.'
                : 'آخرین تغییرات هنوز به‌صورتِ دائمی ذخیره نشده‌اند (خطای حافظهٔ دستگاه). برنامه را نبندید — ذخیره خودکار دوباره تلاش می‌شود.';
            b.style.display = 'block';
        });
    }
    function hideBanner() {
        if (!bannerShown) return; bannerShown = false;
        try { var b = document.getElementById('apex-store-banner'); if (b) b.style.display = 'none'; } catch (e) {}
    }

    // ── همگام‌سازیِ چند زبانه (فقط نسخهٔ وب؛ Tauri/اندروید یک پنجره دارند) ─────────
    var bch = null, peers = false;
    try { if (BOOT && typeof BroadcastChannel === 'function') bch = new BroadcastChannel('apex_store_v1'); } catch (e) { bch = null; }
    function bc(k, v) {
        if (!bch || !peers) return;
        try { bch.postMessage({ k: k, v: v }); } catch (e) {}
    }
    function applyRemote(d) {
        if (d.v === null) { delete owned[d.k]; delete mem[d.k]; }
        else { owned[d.k] = true; mem[d.k] = d.v; }
    }
    if (bch) {
        bch.onmessage = function (e) {
            var d = e && e.data;
            if (!d) return;
            if (d.hello) { peers = true; if (!d.reply) { try { bch.postMessage({ hello: 1, reply: 1 }); } catch (x) {} } return; }
            if (typeof d.k !== 'string') return;
            if (mode === 'idb') applyRemote(d); else remoteEarly.push(d);
        };
        try { bch.postMessage({ hello: 1 }); } catch (e) {}
    }

    // ── صفِ نوشتن در IndexedDB ───────────────────────────────────────────────
    function enqueue(k, op) {
        var prev = queue[k];
        if (op.op === 'put' && !op.ptr && prev && prev.op === 'put' && prev.ptr) { op.ptr = true; op.fp = prev.fp; }
        queue[k] = op;
        schedule();
    }
    function schedule() {
        if (queued) return;
        queued = true;
        nextTick(flush);
    }
    function idle() { return !inflight && !keysOf(queue).length && !tqueue.length; }
    function resolveWaiters() {
        if (!idle()) return;
        var w = waiters; waiters = [];
        for (var i = 0; i < w.length; i++) { try { w[i](true); } catch (e) {} }
    }
    function flush() {
        queued = false;
        if (inflight || !idb) return;
        var keys = keysOf(queue), tdels = tqueue;
        if (!keys.length && !tdels.length) { resolveWaiters(); return; }
        var batch = queue;
        queue = Object.create(null); tqueue = [];
        var tx;
        try { tx = idb.transaction(['kv', 'trans'], 'readwrite', { durability: 'strict' }); }
        catch (e) { return fail(batch, tdels, e); }
        inflight = batch;
        var done = false;
        tx.oncomplete = function () {
            if (done) return; done = true;
            inflight = null; failures = 0; hideBanner();
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i], op = batch[k];
                if (op.op === 'put' && op.ptr && owned[k] === true) {
                    // مقدار با موفقیت ثبت شد → حالا (و فقط حالا) اصلِ localStorage با نشانگر عوض می‌شود
                    try { if (rawGet.call(LS, k) !== PTR) rawSet.call(LS, k, PTR); tqueue.push(k); }
                    catch (e) { /* نشانهٔ انتقال می‌ماند؛ راه‌اندازیِ بعدی کار را تمام می‌کند */ }
                }
            }
            if (keysOf(queue).length || tqueue.length) schedule(); else resolveWaiters();
        };
        tx.onabort = function () {
            if (done) return; done = true;
            inflight = null;
            fail(batch, tdels, tx.error || new Error('IndexedDB transaction aborted'));
        };
        try {
            var kv = tx.objectStore('kv'), tr = tx.objectStore('trans'), i, k, op;
            for (i = 0; i < keys.length; i++) {
                k = keys[i]; op = batch[k];
                if (op.op === 'put') { kv.put(op.v, k); if (op.ptr) tr.put(op.fp, k); }
                else { kv['delete'](k); tr['delete'](k); }
            }
            for (i = 0; i < tdels.length; i++) tr['delete'](tdels[i]);
            if (typeof tx.commit === 'function') tx.commit();
        } catch (e) {
            try { tx.abort(); } catch (x) {}
            if (!done) { done = true; inflight = null; fail(batch, tdels, e); }
        }
    }
    function fail(batch, tdels, err) {
        lastError = err; failures++;
        try { console.error('[apex-store] ذخیره در IndexedDB ناموفق (تلاشِ ' + failures + '):', err); } catch (e) {}
        var ks = keysOf(batch), i, k, b, q;
        for (i = 0; i < ks.length; i++) {
            k = ks[i]; b = batch[k]; q = queue[k];
            if (!q) queue[k] = b;                                   // تغییرِ تازه‌تری نیامده → همین دوباره
            else if (b.op === 'put' && b.ptr && q.op === 'put' && !q.ptr) { q.ptr = true; q.fp = b.fp; }
        }
        tqueue = tdels.concat(tqueue);
        if (failures >= 2) showBanner(err);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
            retryTimer = null;
            if (!idb) { reopen(); return; }
            flush();
        }, Math.min(30000, 300 * Math.pow(2, Math.min(failures, 7))));
    }
    function reopen() {
        openDB().then(function (d) { idb = d; attachDB(d); flush(); }, function (e) { fail(Object.create(null), [], e); });
    }
    function attachDB(d) {
        d.onversionchange = function () { try { d.close(); } catch (e) {} if (idb === d) idb = null; };
        d.onclose = function () { if (idb === d) { idb = null; if (!idle()) reopen(); } };
    }

    // ── باز کردن و خواندنِ پایگاه ────────────────────────────────────────────
    function openDB() {
        return new Promise(function (resolve, reject) {
            var req, settled = false;
            var to = setTimeout(function () { if (!settled) { settled = true; reject(new Error('IndexedDB open timeout')); } }, OPEN_TIMEOUT);
            try { req = indexedDB.open(DB_NAME, DB_VER); }
            catch (e) { clearTimeout(to); settled = true; reject(e); return; }
            req.onupgradeneeded = function () {
                var d = req.result, names = ['kv', 'trans', 'meta', 'backup', 'originals'];
                for (var i = 0; i < names.length; i++) if (!d.objectStoreNames.contains(names[i])) d.createObjectStore(names[i]);
            };
            req.onsuccess = function () {
                clearTimeout(to);
                if (settled) { try { req.result.close(); } catch (e) {} return; }
                settled = true; resolve(req.result);
            };
            req.onerror = function () { clearTimeout(to); if (!settled) { settled = true; reject(req.error || new Error('IndexedDB open error')); } };
        });
    }
    function readStore(d, name, keysOnly) {
        return new Promise(function (resolve, reject) {
            var out = Object.create(null), tx, st, cur;
            try { tx = d.transaction(name, 'readonly'); st = tx.objectStore(name); }
            catch (e) { reject(e); return; }
            try { cur = keysOnly && st.openKeyCursor ? st.openKeyCursor() : st.openCursor(); }
            catch (e) { reject(e); return; }
            cur.onsuccess = function () {
                var c = cur.result;
                if (c) { out[String(c.key)] = keysOnly ? true : c.value; c['continue'](); }
            };
            tx.oncomplete = function () { resolve(out); };
            tx.onabort = tx.onerror = function () { reject(tx.error || new Error('read ' + name + ' failed')); };
        });
    }
    function runTx(d, stores, fn) {
        return new Promise(function (resolve, reject) {
            var tx;
            try { tx = d.transaction(stores, 'readwrite', { durability: 'strict' }); fn(tx); }
            catch (e) { try { if (tx) tx.abort(); } catch (x) {} reject(e); return; }
            tx.oncomplete = function () { resolve(true); };
            tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
            try { if (typeof tx.commit === 'function') tx.commit(); } catch (e) {}
        });
    }
    function getMany(d, name, keys) {
        return new Promise(function (resolve, reject) {
            var out = Object.create(null), tx;
            if (!keys.length) { resolve(out); return; }
            try { tx = d.transaction(name, 'readonly'); } catch (e) { reject(e); return; }
            var st = tx.objectStore(name);
            keys.forEach(function (k) {
                var r = st.get(k);
                r.onsuccess = function () { out[k] = r.result; };
            });
            tx.oncomplete = function () { resolve(out); };
            tx.onabort = tx.onerror = function () { reject(tx.error || new Error('verify read failed')); };
        });
    }
    function bkKey(k, why) { return k + '\u0001' + why + '\u0001' + Date.now() + '\u0001' + Math.random().toString(36).slice(2, 7); }
    function bkParse(id) { var p = String(id).split('\u0001'); return { key: p[0], why: p[1] || '', at: parseInt(p[2], 10) || 0 }; }

    function lsKeys() {
        var a = [], i, n;
        try { n = LS.length; for (i = 0; i < n; i++) { var k = LS.key(i); if (k !== null) a.push(k); } } catch (e) {}
        return a;
    }
    function lsHasPointers() {
        var ks = lsKeys();
        for (var i = 0; i < ks.length; i++) { try { if (rawGet.call(LS, ks[i]) === PTR) return true; } catch (e) {} }
        return false;
    }

    // ── راه‌اندازی: خواندنِ همه‌چیز، تطبیق با localStorage، انتقالِ تأییدشده ─────
    function hydrate() {
        var d, kvMap, trMap, bkIds;
        return openDB().then(function (db0) {
            d = db0;
            return Promise.all([readStore(d, 'kv'), readStore(d, 'trans'), readStore(d, 'backup', true)]);
        }).then(function (r) {
            kvMap = r[0]; trMap = r[1]; bkIds = r[2];
            var hasPremig = Object.create(null);
            keysOf(bkIds).forEach(function (id) { var b = bkParse(id); if (b.why === 'pre-migration') hasPremig[b.key] = true; });

            var ks = lsKeys(), inLS = Object.create(null);
            var ownedNow = Object.create(null), adopt = Object.create(null), pointerize = [];
            var backups = [], kvDel = [], trDel = [], lost = [];
            ks.forEach(function (k) {
                inLS[k] = true;
                var raw; try { raw = rawGet.call(LS, k); } catch (e) { raw = null; }
                if (raw === null) return;
                var hasKv = hasOwn(kvMap, k), hasTr = hasOwn(trMap, k);
                if (raw === PTR) {
                    if (hasKv) { ownedNow[k] = kvMap[k]; if (hasTr) trDel.push(k); }
                    else lost.push(k);
                    return;
                }
                var packed = isPacked(raw);
                var plain = packed ? safeDecode(raw) : raw;
                if (plain === null) return;                      // بازنشدنی: دست‌نخورده می‌ماند
                var big = plain.length >= IDB_MIN || packed;
                if (hasKv) {
                    if (kvMap[k] === plain || (hasTr && trMap[k] === fp(raw))) {
                        // نسخهٔ IndexedDB همان یا تازه‌تر است (قطعِ برق پیش از نوشتنِ نشانگر)
                        ownedNow[k] = kvMap[k]; pointerize.push(k);
                    } else {
                        // مقدارِ localStorage تازه‌تر است (مثلاً نسخهٔ قدیمیِ برنامه روی آن نوشته) →
                        // همان برنده است؛ مقدارِ قبلیِ IndexedDB در backup حفظ می‌شود.
                        backups.push({ id: bkKey(k, 'replaced'), v: kvMap[k] });
                        stats0.superseded++;
                        if (big) { adopt[k] = plain; ownedNow[k] = plain; pointerize.push(k); }
                        else kvDel.push(k);
                    }
                    if (hasTr) trDel.push(k);
                } else if (big) {
                    adopt[k] = plain; ownedNow[k] = plain; pointerize.push(k);
                    if (!hasPremig[k]) backups.push({ id: bkKey(k, 'pre-migration'), v: plain });
                    if (hasTr) trDel.push(k);
                } else if (hasTr) trDel.push(k);
            });
            keysOf(kvMap).forEach(function (k) {
                if (inLS[k]) return;
                if (hasOwn(trMap, k) && trMap[k] === 'N') {           // اولین نوشتنِ یک کلیدِ تازه، پیش از نشانگر
                    ownedNow[k] = kvMap[k]; pointerize.push(k); trDel.push(k);
                } else {                                              // کلید حذف شده بود
                    backups.push({ id: bkKey(k, 'deleted'), v: kvMap[k] });
                    kvDel.push(k);
                    if (hasOwn(trMap, k)) trDel.push(k);
                }
            });
            keysOf(trMap).forEach(function (k) { if (!hasOwn(kvMap, k) && trDel.indexOf(k) < 0) trDel.push(k); });

            var adoptKeys = keysOf(adopt);
            var needWrite = adoptKeys.length || backups.length || kvDel.length || trDel.length;
            var p = needWrite ? runTx(d, ['kv', 'trans', 'backup', 'meta'], function (tx) {
                var kv = tx.objectStore('kv'), tr = tx.objectStore('trans'), bk = tx.objectStore('backup');
                adoptKeys.forEach(function (k) { kv.put(adopt[k], k); });
                kvDel.forEach(function (k) { kv['delete'](k); });
                trDel.forEach(function (k) { tr['delete'](k); });
                backups.forEach(function (b) { bk.put(b.v, b.id); });
                if (adoptKeys.length) tx.objectStore('meta').put({ at: Date.now(), keys: adoptKeys.length }, 'lastMigration');
            }) : Promise.resolve(true);
            return p.then(function () {
                // بازبینیِ حرف‌به‌حرف پیش از جایگزینیِ اصل
                return getMany(d, 'kv', adoptKeys);
            }).then(function (back) {
                var bad = [];
                adoptKeys.forEach(function (k) {
                    if (back[k] !== adopt[k]) { bad.push(k); delete ownedNow[k]; }
                });
                if (bad.length) {
                    try { console.error('[apex-store] بازبینیِ انتقال ناموفق؛ این کلیدها در localStorage ماندند:', bad); } catch (e) {}
                    pointerize = pointerize.filter(function (k) { return bad.indexOf(k) < 0; });
                }
                pointerize.forEach(function (k) {
                    try { rawSet.call(LS, k, PTR); delete zcache[k]; }
                    catch (e) { /* محال: نشانگر کوچک‌تر از اصل است */ }
                });
                stats0.migrated = adoptKeys.length - bad.length;
                // کلیدهایی که نشانگر دارند ولی مقدارشان نیست → از آخرین backup بازیابی
                if (!lost.length) return { d: d, ownedNow: ownedNow, lost: [] };
                return readStore(d, 'backup').then(function (all) {
                    var best = Object.create(null);
                    keysOf(all).forEach(function (id) {
                        var b = bkParse(id);
                        if (lost.indexOf(b.key) < 0) return;
                        if (!best[b.key] || b.at > best[b.key].at) best[b.key] = { at: b.at, v: all[id] };
                    });
                    var rec = lost.filter(function (k) { return best[k] && typeof best[k].v === 'string'; });
                    var still = lost.filter(function (k) { return rec.indexOf(k) < 0; });
                    return runTx(d, ['kv'], function (tx) {
                        var kv = tx.objectStore('kv');
                        rec.forEach(function (k) { kv.put(best[k].v, k); });
                    }).then(function () {
                        rec.forEach(function (k) { ownedNow[k] = best[k].v; });
                        stats0.recovered = rec.length; stats0.lost = still.length;
                        if (rec.length) try { console.warn('[apex-store] از backup بازیابی شد:', rec); } catch (e) {}
                        return { d: d, ownedNow: ownedNow, lost: still };
                    });
                });
            });
        });
    }

    function goIdb(d, ownedNow) {
        idb = d; attachDB(d);
        keysOf(ownedNow).forEach(function (k) { owned[k] = true; mem[k] = ownedNow[k]; });
        mode = 'idb';
        // نوشتن‌های پیش از آماده‌شدن (به همان ترتیب)
        earlyOrder.forEach(function (k) {
            var e = early[k]; if (!e) return;
            try { if (e.del) S.removeItem.call(LS, k); else S.setItem.call(LS, k, e.v); } catch (x) {}
        });
        early = Object.create(null); earlyOrder = [];
        remoteEarly.forEach(applyRemote); remoteEarly = [];
        // درخواستِ «ذخیره‌سازیِ ماندگار» تا مرورگر هنگامِ کمبودِ فضا داده را پاک نکند
        try {
            if (navigator.storage && navigator.storage.persist && !/firefox/i.test(navigator.userAgent || '')) {
                navigator.storage.persisted().then(function (p) { if (!p) navigator.storage.persist(); })['catch'](function () {});
            }
        } catch (e) {}
        setTimeout(pruneBackups, 15000);
    }
    function goLegacy(reason) {
        mode = 'legacy';
        try { console.warn('[apex-store] حالتِ قدیمی (localStorage):', reason); } catch (e) {}
        earlyOrder.forEach(function (k) {
            var e = early[k]; if (!e) return;
            try { if (e.del) { delete zcache[k]; rawDel.call(LS, k); } else legacySet(LS, k, e.v); } catch (x) {}
        });
        early = Object.create(null); earlyOrder = [];
        window.__JQ_STORE_READY = HAS_Z;
    }
    function pruneBackups() {
        if (!idb) return;
        readStore(idb, 'backup', true).then(function (ids) {
            var by = Object.create(null), del = [];
            keysOf(ids).forEach(function (id) {
                var b = bkParse(id);
                if (b.why === 'pre-migration') return;              // نسخهٔ پیش از انتقال همیشه می‌ماند
                (by[b.key] = by[b.key] || []).push({ id: id, at: b.at });
            });
            keysOf(by).forEach(function (k) {
                var a = by[k].sort(function (x, y) { return y.at - x.at; });
                for (var i = 3; i < a.length; i++) del.push(a[i].id);
            });
            if (del.length && idb) return runTx(idb, ['backup'], function (tx) { var s = tx.objectStore('backup'); del.forEach(function (id) { s['delete'](id); }); });
        })['catch'](function () {});
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ۳) جایگزینیِ متدهای Storage (فقط برای localStorage؛ sessionStorage مثلِ قبل)
    // ═════════════════════════════════════════════════════════════════════════
    function warnEarly(k) {
        if (earlyWarned[k]) return; earlyWarned[k] = true;
        try { console.warn('[apex-store] «' + k + '» پیش از آماده‌شدنِ حافظه خوانده شد.'); } catch (e) {}
    }
    function blockedError() { var e = new Error('حافظهٔ برنامه آماده نیست؛ برنامه را دوباره باز کنید.'); e.name = 'ApexStoreBlocked'; return e; }

    S.getItem = function (key) {
        if (this !== LS || mode === 'legacy') return readPlain(key, rawGet.call(this, key));
        key = String(key);
        if (mode === 'idb') {
            if (owned[key] === true) return mem[key];
            var v = rawGet.call(this, key);
            if (v === PTR) return null;
            return readPlain(key, v);
        }
        if (hasOwn(early, key)) return early[key].del ? null : early[key].v;
        var r = rawGet.call(this, key);
        if (r === PTR) { warnEarly(key); return null; }
        return readPlain(key, r);
    };

    S.setItem = function (key, value) {
        if (this !== LS || mode === 'legacy') return legacySet(this, key, value);
        key = String(key);
        var plain = (typeof value === 'string') ? value : String(value);
        if (mode === 'idb') {
            if (owned[key] === true) {
                if (mem[key] === plain) return;
                mem[key] = plain;
                enqueue(key, { op: 'put', v: plain });
                bc(key, plain);
                return;
            }
            if (plain.length >= IDB_MIN) {
                var before = rawGet.call(this, key);
                owned[key] = true; mem[key] = plain; delete zcache[key];
                enqueue(key, { op: 'put', v: plain, ptr: true, fp: fp(before) });
                bc(key, plain);
                return;
            }
            delete zcache[key];
            return rawSet.call(this, key, plain);
        }
        if (mode === 'blocked') throw blockedError();
        // pending: پیش از آماده‌شدن
        var r = rawGet.call(this, key);
        if (r === PTR || plain.length >= IDB_MIN || hasOwn(early, key)) {
            if (!hasOwn(early, key)) earlyOrder.push(key);
            early[key] = { v: plain };
            return;
        }
        delete zcache[key];
        return rawSet.call(this, key, plain);
    };

    if (typeof rawDel === 'function') {
        S.removeItem = function (key) {
            if (this !== LS || mode === 'legacy') { delete zcache[key]; return rawDel.call(this, key); }
            key = String(key);
            if (mode === 'blocked') throw blockedError();
            delete zcache[key];
            if (mode === 'idb') {
                if (owned[key] === true) {
                    delete owned[key]; delete mem[key];
                    enqueue(key, { op: 'del' });
                    bc(key, null);
                }
                return rawDel.call(this, key);
            }
            if (!hasOwn(early, key)) earlyOrder.push(key);
            early[key] = { del: true };
            return rawDel.call(this, key);
        };
    }
    if (typeof rawClear === 'function') {
        S.clear = function () {
            if (this !== LS || mode === 'legacy') { zcache = Object.create(null); return rawClear.call(this); }
            if (mode === 'blocked') throw blockedError();
            zcache = Object.create(null);
            if (mode === 'idb') {
                keysOf(owned).forEach(function (k) { enqueue(k, { op: 'del' }); bc(k, null); });
                owned = Object.create(null); mem = Object.create(null);
            } else {
                early = Object.create(null); earlyOrder = [];
            }
            return rawClear.call(this);
        };
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ۴) API و ابزارِ عیب‌یابی (برنامه به این‌ها وابسته نیست)
    // ═════════════════════════════════════════════════════════════════════════
    function whenSaved() {
        return new Promise(function (resolve) {
            if (mode !== 'idb' || idle()) { resolve(true); return; }
            waiters.push(resolve);
        });
    }
    var readyResolve;
    var ready = new Promise(function (res) { readyResolve = res; });

    window.JouyaStore = {
        version: 2,
        ready: ready,
        mode: function () { return mode; },
        whenSaved: whenSaved,
        pending: function () { return keysOf(queue).length + (inflight ? keysOf(inflight).length : 0); },
        stats: function () {
            var o = { mode: mode, idbKeys: 0, idbChars: 0, lsChars: 0, pending: this.pending(), failures: failures,
                      lastError: lastError ? String(lastError.name || lastError.message || lastError) : null,
                      migrated: stats0.migrated, recovered: stats0.recovered, lost: stats0.lost, superseded: stats0.superseded };
            keysOf(owned).forEach(function (k) { o.idbKeys++; o.idbChars += (mem[k] || '').length; });
            lsKeys().forEach(function (k) { try { o.lsChars += (rawGet.call(LS, k) || '').length + k.length; } catch (e) {} });
            return new Promise(function (resolve) {
                try {
                    if (navigator.storage && navigator.storage.estimate) {
                        navigator.storage.estimate().then(function (e) { o.usage = e.usage; o.quota = e.quota; resolve(o); }, function () { resolve(o); });
                        return;
                    }
                } catch (e) {}
                resolve(o);
            });
        },
        // نگهداریِ نسخهٔ اصلیِ یک تصویر پیش از کوچک‌کردن (خارج از دادهٔ برنامه؛ سینک/خروجی نمی‌شود)
        keepOriginal: function (ref, dataUrl) {
            if (mode !== 'idb' || !idb) return Promise.resolve(false);
            return runTx(idb, ['originals'], function (tx) {
                tx.objectStore('originals').put({ ref: String(ref), at: Date.now(), data: dataUrl }, String(ref) + '\u0001' + Date.now());
            }).then(function () { return true; }, function () { return false; });
        },
        listOriginals: function () {
            if (!idb) return Promise.resolve([]);
            return readStore(idb, 'originals').then(function (all) {
                return keysOf(all).map(function (id) { var o = all[id] || {}; return { id: id, ref: o.ref, at: o.at, chars: (o.data || '').length }; });
            });
        },
        getOriginal: function (id) {
            if (!idb) return Promise.resolve(null);
            return getMany(idb, 'originals', [id]).then(function (r) { return r[id] ? r[id].data : null; });
        },
        listBackups: function () {
            if (!idb) return Promise.resolve([]);
            return readStore(idb, 'backup').then(function (all) {
                return keysOf(all).map(function (id) { var b = bkParse(id); return { id: id, key: b.key, why: b.why, at: b.at, chars: (all[id] || '').length }; })
                    .sort(function (a, b) { return b.at - a.at; });
            });
        },
        // بازگرداندنِ یک نسخهٔ backup روی همان کلید (از مسیرِ عادیِ setItem؛ برای پشتیبانی)
        restoreBackup: function (id) {
            if (!idb) return Promise.resolve(false);
            return getMany(idb, 'backup', [id]).then(function (r) {
                var v = r[id]; if (typeof v !== 'string') return false;
                localStorage.setItem(bkParse(id).key, v);
                return whenSaved();
            });
        }
    };

    // سازگاری با ابزارهای عیب‌یابیِ نسخهٔ قبلی (script.js → __hbStorageReport)
    window.__jqStoreRawSet = function (key, value) { return rawSet.call(LS, key, value); };
    window.__jqStoreRawGet = function (key) { return rawGet.call(LS, key); };
    window.__jqStoreRawLen = function (key) {
        try { var v = rawGet.call(LS, key); return v == null ? 0 : v.length; } catch (e) { return 0; }
    };
    window.__jqStoreIsPacked = function (key) {
        try { return isPacked(rawGet.call(LS, key)); } catch (e) { return false; }
    };
    window.__jqStoreReport = function () {
        var rows = [], total = 0, plainTotal = 0;
        lsKeys().forEach(function (k) {
            var raw = rawGet.call(LS, k) || '', pl;
            if (raw === PTR) pl = mem[k] || ''; else pl = isPacked(raw) ? (readPlain(k, raw) || '') : raw;
            total += raw.length + k.length; plainTotal += pl.length + k.length;
            rows.push({ key: k, stored: raw.length, plain: pl.length, packed: isPacked(raw), idb: raw === PTR });
        });
        rows.sort(function (a, b) { return b.plain - a.plain; });
        return { mode: mode, storedChars: total, plainChars: plainTotal, limitChars: 5242880,
                 usedPercent: Math.round(total / 5242880 * 1000) / 10,
                 ratio: total ? Math.round(plainTotal / total * 10) / 10 : 1, top: rows.slice(0, 12) };
    };
    window.__jqStoreCompact = function () {
        if (mode !== 'legacy' || !HAS_Z) return { compacted: 0, savedChars: 0 };
        var done = 0, saved = 0;
        lsKeys().forEach(function (k) {
            try {
                var raw = rawGet.call(LS, k);
                if (raw == null || raw.length < THRESHOLD || isPacked(raw) || raw === PTR) return;
                var before = raw.length;
                legacySet(LS, k, raw);
                var after = window.__jqStoreRawLen(k);
                if (after < before) { done++; saved += (before - after); }
            } catch (e) {}
        });
        return { compacted: done, savedChars: saved };
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  ۵) شروع
    // ═════════════════════════════════════════════════════════════════════════
    if (!BOOT) {
        // صفحهٔ قدیمی (بدونِ بوتِ مرحله‌ای): همان رفتارِ نسخهٔ قبلی. اگر داده قبلاً به
        // IndexedDB منتقل شده باشد، این صفحه نمی‌تواند آن را بخواند → هشدار و جلوگیری از بازنویسی.
        window.__JQ_STORE_READY = HAS_Z;
        if (lsHasPointers()) {
            showBlock('نسخهٔ برنامه ناقص بارگذاری شد',
                'اطلاعاتِ شما سالم و در حافظهٔ جدیدِ برنامه است، ولی این صفحه از نسخهٔ قدیمیِ برنامه است.<br>برنامه را ببندید و دوباره باز کنید (در مرورگر: صفحه را تازه کنید).', false);
        } else if (HAS_Z) {
            try {
                var kick = function () { try { window.__jqStoreCompact(); } catch (e) {} };
                if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(kick, { timeout: 8000 });
                else setTimeout(kick, 2500);
            } catch (e) {}
        }
        readyResolve({ mode: 'legacy' });
        return;
    }

    var hasIDB = false;
    try { hasIDB = (typeof indexedDB !== 'undefined' && !!indexedDB && typeof Promise === 'function'); } catch (e) { hasIDB = false; }
    if (!hasIDB) {
        if (lsHasPointers()) {
            mode = 'blocked';
            showBlock('حافظهٔ برنامه باز نشد', 'اطلاعاتِ شما در حافظهٔ دستگاه سالم است ولی این محیط به آن دسترسی ندارد. برنامه را دوباره باز کنید.', false);
            readyResolve({ mode: 'blocked', blocked: true });
        } else { goLegacy('IndexedDB در دسترس نیست'); readyResolve({ mode: 'legacy' }); }
        return;
    }

    hydrate().then(function (res) {
        if (res.lost.length) {
            mode = 'blocked';
            try { console.error('[apex-store] مقدارِ این کلیدها پیدا نشد:', res.lost); } catch (e) {}
            showBlock('بخشی از اطلاعات پیدا نشد',
                'مقدارِ این بخش‌ها در حافظهٔ دستگاه پیدا نشد: <b dir="ltr">' + res.lost.join(', ') + '</b><br>' +
                'اگر فایلِ پشتیبانِ JSON دارید، پس از ادامه آن را وارد کنید. ابتدا «تلاشِ دوباره» را امتحان کنید.', true,
                function () {
                    res.lost.forEach(function (k) { try { rawDel.call(LS, k); } catch (e) {} });
                    goIdb(res.d, res.ownedNow);
                    readyResolve({ mode: 'idb' });
                });
            return;   // ready تا تصمیمِ کاربر باز نمی‌شود
        }
        goIdb(res.d, res.ownedNow);
        readyResolve({ mode: 'idb', migrated: stats0.migrated });
    })['catch'](function (err) {
        lastError = err;
        try { console.error('[apex-store] راه‌اندازیِ IndexedDB ناموفق:', err); } catch (e) {}
        if (lsHasPointers()) {
            mode = 'blocked';
            showBlock('حافظهٔ برنامه باز نشد',
                'اطلاعاتِ شما در حافظهٔ دستگاه سالم است ولی این بار باز نشد. «تلاشِ دوباره» را بزنید؛ اگر ادامه داشت، دستگاه را یک بار ری‌استارت کنید.', false);
            readyResolve({ mode: 'blocked', blocked: true });
        } else {
            goLegacy(err && (err.message || err.name));
            readyResolve({ mode: 'legacy' });
        }
    });
})();
