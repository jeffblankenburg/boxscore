// Shared shape for vendor → canonical mapping documents. Both
// mappings-statsapi.ts and mappings-sportsdataio.ts conform to this.

export type MappingStatus =
  | "direct"      // canonical reads vendor value without transform
  | "transformed" // enum map, parse, one-step rename
  | "derived"     // computed from multiple vendor inputs
  | "degraded"    // canonical field populated but reduced fidelity
  | "unwired"     // vendor exposes it (different endpoint or unmapped field) but adapter doesn't pull it yet
  | "missing";    // vendor's full catalog has no source for this — real gap

export type FieldMapping = {
  canonical: string;
  vendor: string;
  status: MappingStatus;
  notes?: string;
};

export type TypeMapping = {
  canonicalType: string;     // the canonical type name this table documents
  endpoint: string;          // vendor endpoint(s) the fields come from
  fields: FieldMapping[];
};

export type UnmappedVendorGroup = {
  type: string;              // vendor envelope or endpoint name
  fields: Array<{ vendor: string; notes?: string }>;
};

export type MlbSourceMapping = {
  vendor: string;            // human label ("statsapi.mlb.com")
  baseUrl: string;
  notes: string[];           // top-of-page context
  types: TypeMapping[];
  unmappedVendor: UnmappedVendorGroup[];
};
