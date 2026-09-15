Shader "ZKube/StoneSurface"
{
    Properties
    {
        [PerRendererData] _MainTex ("Sprite Texture", 2D) = "white" {}
        _Color ("Sprite Color", Color) = (1,1,1,1)
        _Tint ("Realm Accent", Color) = (.3,.68,.31,1)
        _BlackVeil ("Black Veil", Range(0,1)) = .62
        [HideInInspector] _RendererColor ("Renderer Color", Color) = (1,1,1,1)
        [HideInInspector] _Flip ("Flip", Vector) = (1,1,1,1)
        [PerRendererData] _AlphaTex ("External Alpha", 2D) = "white" {}
        [PerRendererData] _EnableExternalAlpha ("Enable External Alpha", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" "CanUseSpriteAtlas"="True" }
        Cull Off
        Lighting Off
        ZWrite Off
        Blend One OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex SpriteVert
            #pragma fragment StoneFrag
            #pragma multi_compile_instancing
            #pragma multi_compile _ ETC1_EXTERNAL_ALPHA
            #include "UnitySprites.cginc"
            float4 _Tint;
            float _BlackVeil;
            float Lum(float3 c) { return dot(c, float3(.3,.59,.11)); }
            float3 ColorBlend(float3 backdrop, float3 tint)
            {
                // The brief's CSS color blend: retain stone luminance, use the
                // generated accent's hue/saturation, then apply the black veil.
                // ClipColor keeps its initial L/n/x across both conditionals:
                // https://www.w3.org/TR/compositing-1/#blendingnonseparable
                float3 c = tint + Lum(backdrop) - Lum(tint);
                float l = Lum(c), low = min(c.r, min(c.g,c.b)), high = max(c.r,max(c.g,c.b));
                if (low < 0) c = l + ((c-l)*l)/max(l-low,.0001);
                if (high > 1) c = l + ((c-l)*(1-l))/max(high-l,.0001);
                return saturate(c);
            }
            fixed4 StoneFrag(v2f input) : SV_Target
            {
                fixed4 source = SampleSpriteTexture(input.texcoord);
                float alpha = source.a * input.color.a;
                float3 tinted = ColorBlend(source.rgb, _Tint.rgb) * (1-_BlackVeil) * input.color.rgb;
                return fixed4(tinted*alpha, alpha);
            }
            ENDCG
        }
    }
}
