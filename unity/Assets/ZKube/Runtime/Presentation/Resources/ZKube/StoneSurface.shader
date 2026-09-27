Shader "ZKube/StoneSurface"
{
    Properties
    {
        [PerRendererData] _MainTex ("Sprite Texture", 2D) = "white" {}
        _Tint ("Realm Accent", Color) = (.3,.68,.31,1)
        _BlackVeil ("Black Veil", Range(0,1)) = .62
        [HideInInspector] _RendererColor ("Renderer Color", Color) = (1,1,1,1)
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" "CanUseSpriteAtlas"="True" }
        Cull Off
        ZWrite Off
        Blend One OneMinusSrcAlpha
        Pass
        {
            Tags { "LightMode"="Universal2D" }
            HLSLPROGRAM
            #pragma vertex StoneVert
            #pragma fragment StoneFrag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float _BlackVeil;
            CBUFFER_END

            struct Attributes { float3 positionOS : POSITION; float4 color : COLOR; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float4 color : COLOR; float2 uv : TEXCOORD0; };

            Varyings StoneVert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS);
                output.color = input.color;
                output.uv = input.uv;
                return output;
            }

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

            half4 StoneFrag(Varyings input) : SV_Target
            {
                float4 source = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv);
                float alpha = source.a * input.color.a;
                float3 tinted = ColorBlend(source.rgb, _Tint.rgb) * (1-_BlackVeil) * input.color.rgb;
                return half4(tinted*alpha, alpha);
            }
            ENDHLSL
        }
    }
}
