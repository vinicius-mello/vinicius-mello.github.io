#include "common.glsl"
#include "complex.glsl"

uniform vec2 uq;
uniform vec2 up;
uniform vec2 udir;
uniform float texSize;
uniform float inverted;

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
    z=cx_div(z-a,vec2(1.0,0.0)+cx_mul(cx_conj(a),z));
    z=texSize*cx_div(z,d);
    return z;
}

// antipodal map: identifies the boundary circle into a projective plane
vec2 glue(vec2 z, float l) {
    return -z/(l*l);
}

bool inside(vec2 zn) {
    return max(abs(zn.x),abs(zn.y))<=1.0;
}

// crossing the boundary reverses orientation: mirror the sprite
vec2 tex_coord(vec2 zn) {
    vec2 t=0.5*(zn+1.0);
    t.t=0.5+inverted*(t.t-0.5);
    return t;
}

void main(void)
{
    vec2 z=vCoord;
    float l=length(z);
    vec2 zg=inv_trans(glue(z,l), uq, udir);
    vec2 zn=inv_trans(z, uq, udir);
    // sample before branching, so mipmap derivatives are well defined
    vec4 cg=texture2D(uTexture, tex_coord(zg));
    vec4 cn=texture2D(uTexture, tex_coord(zn));
    if(l>=1.0) {
        gl_FragColor = vec4(0.09,0.09,0.09,0.5);
        return;
    }
    if(inside(zg)) gl_FragColor=cg;
    else if(inside(zn)) gl_FragColor=cn;
    else discard;
}

#endif
