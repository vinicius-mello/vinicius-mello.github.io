#include "../../../assets/shaders/common.glsl"
#include "../../../assets/shaders/complex.glsl"

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

vec2 glue(vec2 z, float l) {
    return -z/(l*l);
}

bool inside_tex(vec2 zn, vec2 a, vec2 d, sampler2D tex, bool glued) {
    zn=inv_trans(zn,a,d);
    float m=max(abs(zn.x),abs(zn.y));
    if(m<=1.0) {
        vec2 texCoord = 0.5*(zn+1.0);
        // if (!glued) texCoord.t *= -1.0;
         texCoord.t *= inverted;
        gl_FragColor = texture2D(tex, texCoord);
        return true;
    }
    return false;
}

bool tex_glue(vec2 z, vec2 a, vec2 d, sampler2D tex) {
    float l=length(z);
    if(inside_tex(glue(z,l), a, d, tex, true)) return true;
    if(inside_tex(z, a, d, tex, false)) return true;
    return false;
}

void main(void)
{
    vec2 z=vCoord;
    vec2 d=udir;
    vec2 a=uq;
    float l=length(z);
    if(l>=1.0) {
        gl_FragColor = vec4(0.09,0.09,0.09,0.5);
        return;
    }
    if(!tex_glue(z, a, d, uTexture)) discard;
}

#endif

