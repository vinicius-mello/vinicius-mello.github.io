#include "../../../assets/shaders/common.glsl"
#include "../../../assets/shaders/complex.glsl"

uniform vec2 uq;
uniform vec2 up;
uniform vec2 udir;
uniform float texSize;
uniform float glueSide1;
uniform float glueSide2;

uniform sampler2D uBackground;

varying vec2 vCoord;

#ifdef VERTEX_SHADER
void main(void)
{
    gl_Position = vec4(aVertexPosition, 1.0);
    vCoord = 2.0*aTextureCoord-1.0;
}
#endif

#ifdef FRAGMENT_SHADER

#define M_PI 3.1415926535897932384626433832795
float sqr2 = sqrt(2.0);
float sqr4 = sqrt(sqr2);
float l = (sqr4+1.0/sqr4)/2.0;
float C = l/cos(M_PI/8.0);
float R = C*tan(M_PI/8.0);

vec2 octagon(float i) {
   float ang=i*M_PI/4.0;
   return C*vec2(cos(ang),sin(ang));
}

vec2 inversion(vec2 z, vec2 z0, float k) {
    float l=length(z-z0);
    return z0+k*k*(z-z0)/(l*l);
}

vec2 reflection_origin(vec2 z, vec2 d) {
    float f=2.0*dot(z,d)/dot(d,d);
    return f*d-z;
}

vec2 glue(vec2 z, vec2 c) {
    vec2 perp=vec2(-c.y,c.x);
    return inversion(reflection_origin(z,perp),-c,R);
}

vec2 inv_trans(vec2 z, vec2 a, vec2 d) {
    z=cx_div(z-a,vec2(1.0,0.0)-cx_mul(cx_conj(a),z));
    z=texSize*cx_div(z,d);
    return z;
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
    float nearestSide = float(glueSide1);
    if(inside_tex(z, a, d, tex)) return true;
    if(inside_tex(glue(z,octagon(nearestSide)), a, d, tex)) return true;
    nearestSide = float(glueSide2);
    if(inside_tex(glue(z,octagon(nearestSide)), a, d, tex)) return true;
    // for(int i=0;i<8;++i) {
    //     if(inside_tex(glue(z,octagon(float(i))), a, d, tex)) return true;
    // }
    return false;
}

void main(void)
{
    vec4 outerColor = vec4(0.05,0.05,0.05,0.5);
    vec4 innerColor = vec4(0.1,0.1,0.1,0.5);
    vec2 z=vCoord;
    vec2 d=udir;
    vec2 a=uq;
    if(length(z)>=1.0) {
        gl_FragColor = outerColor;
        return;
    }
    
    for(int i=0;i<8;++i) {
        if(length(z-octagon(float(i)))<R) {
            gl_FragColor = innerColor;
            return;
        }
    }
    bool r=tex_glue(z, a, d, uTexture);
    
    if(!r) 
     discard;
}

#endif
