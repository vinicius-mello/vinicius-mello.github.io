#include "../../../assets/shaders/common.glsl"
#include "../../../assets/shaders/complex.glsl"

varying vec2 vCoord;

#ifdef VERTEX_SHADER
void main(void)
{
    gl_Position = vec4(aVertexPosition, 1.0);
    vCoord = 2.0*aTextureCoord-1.0;
    //vCoord = aVertexPosition.xy;
}
#endif

#ifdef FRAGMENT_SHADER

#define M_PI 3.1415926535897932384626433832795
float sqr2 = sqrt(2.0);
float sqr4 = sqrt(sqr2);
float l = (sqr4+1.0/sqr4)/2.0;
float C = l/cos(M_PI/8.0);
float R = C*tan(M_PI/8.0);

void main(void)
{
    vec2 z=vCoord;
    vec2 c=vec2(C,0);
    bool flag=false;
    for(int i=0;i<8;i++) {
        vec2 r=vec2(cos(M_PI/4.0*float(i)), sin(M_PI/4.0*float(i)));
        vec2 cr=cx_mul(c, r);
        if(length(cr-z)<R) {
            //gl_FragColor=vec4(1.0,1.0,0.0,1.0);
            flag=true;
        }
    }
    if(flag) gl_FragColor=vec4(1.0,0.0,0.0,0.5);
    else gl_FragColor=vec4(0.0,0.0,0.0,0.0);
}

#endif
