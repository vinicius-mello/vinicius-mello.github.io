#include "../../../assets/shaders/common.glsl"
#include "../../../assets/shaders/complex.glsl"

uniform float time;
uniform vec2 resolution;

// varying vec2 vCoord;

#ifdef VERTEX_SHADER
void main(void)
{
    gl_Position = vec4(aVertexPosition, 1.0);

    // vCoord = 2.0*aTextureCoord-1.0;
}
#endif

#ifdef FRAGMENT_SHADER
// based on: http://glsl.herokuapp.com/e#6904.0
//      and: http://glslsandbox.com/e#25414.0


vec3 nrand3( vec2 co )
{
   vec3 a = fract( sin( co.x*8.3e-3 + co.y )*vec3(1.3e5, 4.7e5, 2.9e5) );	
   vec3 b = fract( sin( co.x*0.3e-3 + co.y )*vec3(8.1e5, 1.0e5, 0.1e5) );
   vec3 c = a* b;
   return c;
}

void main()
{
   vec2 uv = 2. * gl_FragCoord.xy / resolution.xy - 1.0;
   vec2 uvs = uv * resolution.xy / max(resolution.x, resolution.y);
   vec3 p = vec3(uvs / 4.0, 0) + vec3(1., -1.3, 0.0);
   p += .1 * vec3(time/14.0, 0.0,  0.0);
  
   float freqs[4];
   freqs[0] = 0.05;
   freqs[1] = 0.3; 
   freqs[2] = 0.3;
   freqs[3] = 0.3; 
   
   float v = (1.0 - exp((abs(uv.x) - 1.0) * 6.0)) * (1.0 - exp((abs(uv.y) - 1.0) * 6.0));
   
   //stars
   vec2 seed = p.xy * 2.0;   
   seed = floor(seed * resolution.x);
   vec3 rnd = nrand3( seed );
   vec4 starcolor = vec4(pow(rnd.y,20.0));
  
   //layer 2
   vec3 p2 = vec3(uvs / (4.0 + 1.0), 1.5) + vec3(2.0, -1.3, -1.0);
   p2 += 0.25 * vec3(time / 16.0, 1.0,  1.0);
   vec2 seed2 = p2.xy * 2.0;
   seed2 = floor(seed2 * resolution.x);
   vec3 rnd2 = nrand3( seed2 );
	starcolor += vec4(pow(rnd2.x*1.01,40.0));

   //layer 4  
   p2 += 0.25 * vec3(time / 8.0, 1.0, 1.0);
   vec2 seed4 = p2.xy * 4.0;
   seed4 = floor(seed4 * resolution.x);
   vec3 rnd4 = nrand3( seed4 );
	starcolor += vec4(pow(rnd4.x*1.01, 40.0));	
   
   // starcolor += vec4(vec3(0.0), 1.0);
   gl_FragColor = starcolor;
}


#endif