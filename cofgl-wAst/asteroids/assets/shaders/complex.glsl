#ifndef COMPLEX_GLSL_INCLUDED
#define COMPLEX_GLSL_INCLUDED

#define cx_conj(a) vec2(a.x,-a.y)
#define cx_mul(a, b) vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x)
#define cx_modulus(a) length(a)
#define cx_arg(a) atan2(a.y,a.x)

vec2 cx_inv(vec2 z) {
   float re,im,s;
   if(abs(z.x)>=abs(z.y)) {
      s  = 1.0 / (z.x + z.y*(z.y/z.x));
      re = s;
      im = s * (-z.y/z.x);
   } else {
      s  = 1.0 / (z.x*(z.x/z.y) + z.y);
      re = s * (z.x/z.y);
      im = -s;
   }
   return vec2(re,im);
}

vec2 cx_div(vec2 a, vec2 b) {
   float re,im,s;
   if(abs(b.x) >= abs(b.y)) {
      float byox = b.y/b.x;
      s  = 1.0 / (b.x + b.y*byox);
      re = s * (a.x + a.y*byox);
      im = s * (a.y - a.x*byox);
   } else {
      float bxoy = b.x/b.y;
      s  = 1.0 / (b.x*bxoy + b.y);
      re = s * (a.x*bxoy + a.y);
      im = s * (a.y*bxoy - a.x);
   }
   return vec2(re,im);
}

#endif
