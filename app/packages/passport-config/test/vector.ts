/** Shared test vector from docs/TECHNICAL-REFERENCE.md "Canonical bytes and CID profile". */
export const VECTOR_ENVELOPE = {
  schema: "idpp-passport/1",
  deploymentId: "whisky-v2-final",
  tokenId: "97000000000000",
  revision: "0",
  previousCid: null,
  kind: "cask",
  granularity: "item",
  data: {
    distillery: "Demo Distillery",
    caskType: "Bourbon barrel",
    caskNumber: "1",
    volumeLiters: "200",
    alcoholByVolume: "63.5",
    fillDate: "2026-10-01",
  },
} as const;

export const VECTOR_CANONICAL =
  '{"data":{"alcoholByVolume":"63.5","caskNumber":"1","caskType":"Bourbon barrel","distillery":"Demo Distillery","fillDate":"2026-10-01","volumeLiters":"200"},"deploymentId":"whisky-v2-final","granularity":"item","kind":"cask","previousCid":null,"revision":"0","schema":"idpp-passport/1","tokenId":"97000000000000"}';

export const VECTOR_SHA256 = "2da18698cf972e03ca36702052154c30face10dc28b4d66110a23b90e03bc33b";

export const VECTOR_CID = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
