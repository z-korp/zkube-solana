// A sprite's silhouette in one flat colour: the texture's alpha, the
// renderer's colour. A breaking block flashes white on its own shape.
Shader "ZKube/SpriteFlash"
{
    Properties { _MainTex ("Sprite", 2D) = "white" {} }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector" = "True" "PreviewType" = "Plane" }
        Blend SrcAlpha OneMinusSrcAlpha
        Cull Off ZWrite Off
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            sampler2D _MainTex;
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            struct v2f { float4 position : SV_POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            v2f vert(appdata v)
            {
                v2f o; o.position = UnityObjectToClipPos(v.vertex); o.uv = v.uv; o.color = v.color; return o;
            }
            half4 frag(v2f i) : SV_Target { return half4(i.color.rgb, tex2D(_MainTex, i.uv).a * i.color.a); }
            ENDHLSL
        }
    }
}
