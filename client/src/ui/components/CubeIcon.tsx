import React from "react";

interface CubeIconProps {
  className?: string;
  size?: "xs" | "sm" | "base" | "lg" | "xl";
}

const sizeMap = {
  xs: "h-5 w-5",
  sm: "h-7 w-7",
  base: "h-8 w-8",
  lg: "h-10 w-10",
  xl: "h-14 w-14",
} as const;

const CubeIcon: React.FC<CubeIconProps> = ({ className, size = "base" }) => (
  <img
    src="/assets/logo-zkorp-cube.png"
    alt="ZKUBE"
    className={className ?? `${sizeMap[size]} inline-block`}
  />
);

export default CubeIcon;
