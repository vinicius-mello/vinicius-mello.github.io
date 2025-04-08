#include "../../../assets/shaders/common.glsl"
#include "../../../assets/shaders/complex.glsl"

uniform vec2 uq;
uniform vec2 up;
uniform vec2 udir;
uniform float texSize;

varying vec2 vCoord;

#ifdef VERTEX_SHADER
void main(void)
{
    gl_Position = vec4(aVertexPosition, 1.0);
    vCoord = 2.0*aTextureCoord-1.0;
}
#endif

#ifdef FRAGMENT_SHADER

vec2 inv_trans(vec2 z, vec2 a, vec2 d) {
    z=z-a;
    z=texSize*cx_div(z,d);
    return z;
}

vec2 glue(vec2 z, vec2 v) {
    return z+v;
}

bool inside_tex(vec2 zn, vec2 a, vec2 d, sampler2D tex) {
    zn=inv_trans(zn,a,d);
    float m=max(abs(zn.x),abs(zn.y));
    if(m<=1.0) {
        gl_FragColor = texture2D(tex,0.5*(zn+1.0));
        return true;
    }
    return false;
}

bool tex_glue(vec2 z, vec2 a, vec2 d, sampler2D tex) {
    if(inside_tex(glue(z,vec2(2.0,0.0)), a, d, tex)) return true;
    if(inside_tex(glue(z,-vec2(2.0,0.0)), a, d, tex)) return true;
    if(inside_tex(glue(z,vec2(0.0,2.0)), a, d, tex)) return true;
    if(inside_tex(glue(z,-vec2(0.0,2.0)), a, d, tex)) return true;
    if(inside_tex(z, a, d, tex)) return true;
    return false;
}

void main(void)
{
    vec2 z=vCoord;
    vec2 d=udir;
    vec2 a=uq;
    if(!tex_glue(z,a,d,uTexture)) discard;
}

#endif
