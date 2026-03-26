const productName = import.meta.env.VITE_PRODUCT_NAME || "Claworc";
const productShortName = import.meta.env.VITE_PRODUCT_SHORT_NAME || productName;
const productTagline = import.meta.env.VITE_PRODUCT_TAGLINE || "OpenClaw Orchestrator";

export const branding = {
  productName,
  productShortName,
  productTagline,
  documentTitle: `${productName} - ${productTagline}`,
};
