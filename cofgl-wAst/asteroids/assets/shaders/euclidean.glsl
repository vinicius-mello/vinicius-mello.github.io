#include "common.glsl"
#include "complex.glsl"

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

void main(void)
{
    vec2 z=vCoord;
    vec4 color=vec4(0.0);
    bool found=false;
    // The sprite and its 8 translated copies (torus). Every copy is sampled,
    // so texture2D runs in uniform control flow and the mipmap level stays
    // well defined at the sprite's edge.
    for(int i=-1;i<=1;++i) {
        for(int j=-1;j<=1;++j) {
            vec2 zn=inv_trans(glue(z,vec2(2.0*float(i),2.0*float(j))), uq, udir);
            vec4 c=texture2D(uTexture,0.5*(zn+1.0));
            if(!found && max(abs(zn.x),abs(zn.y))<=1.0) {
                color=c;
                found=true;
            }
        }
    }
    if(!found) discard;
    gl_FragColor=color;
}

#endif
