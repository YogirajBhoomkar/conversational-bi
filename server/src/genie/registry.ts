import type { GenieSpace } from '../contracts';

// Add the other Genie spaces here (or load from config); agents and routing are built from this list.
export const genieSpaces: GenieSpace[] = [
  {
    key: 'placement',
    name: 'Lab – Placement Core',
    description:
      'Insurance placement analytics: placement count, layer count, total limit and total FOT premium by underwriting year, region, client, branch office, line of business and placement status. Owns ALL placement, status, layer and FOT premium questions, including chart requests. No policy-level or transaction detail.',
    spaceId: process.env.DATABRICKS_GENIE_SPACE_ID ?? '01f1c5a2df2c1783a45ce199f5b86f91',
  },
  {
    key: 'capacity',
    name: 'Lab – Capacity & Reinsurer',
    description:
      'Reinsurance capacity and reinsurer activity: authorized vs signed limit, unused capacity, declines to quote and quoted premium by reinsurer, rating, underwriting year, region, placement status and line of business. Owns reinsurer, capacity, authorized/signed, declines and quoted premium questions. Not for FOT premium, total limit, placement count or layer count. No contract terms, policy-level detail, claims or qualitative placement reasons.',
    spaceId: process.env.DATABRICKS_GENIE_CAPACITY_SPACE_ID ?? '01f1c5a5a4111dd79d58a788493701c9',
  },
];

export const getSpaceByKey = (key: string) => genieSpaces.find((s) => s.key === key);
export const getSpaceById = (id: string) => genieSpaces.find((s) => s.spaceId === id);
