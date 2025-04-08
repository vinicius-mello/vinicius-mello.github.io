#include "common.glsl"

#ifdef VERTEX_SHADER
void main(void)
{
    gl_Position = vec4(aVertexPosition, 1.0);
}
#endif

#ifdef FRAGMENT_SHADER
void main(void)
{
	vec2 inverseVP = vec2(1.0 / uViewportSize.x, 1.0 / uViewportSize.y);
    gl_FragColor = texture2D(uTexture, gl_FragCoord.xy * inverseVP);
}
#endif
