export interface Product {
    id: string;
    merchantId: string;
    variantId: string; // id = toque, variant = spring_2018
    cost: number;
    metadata: string;
    tags: string[]; // ie ["seasonal", "accessory"] by being prescriptive that products should have tags it might make it easy to run rule based promotions
}