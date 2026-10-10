export interface CreateLeadInput {
  name: string;
  email: string;
  phone: string;
  source: string;
  status?: string;
}

export type LeadUpdateInput = Partial<CreateLeadInput>;

export interface LeadFilters {
  page: number;
  limit: number;
  status?: string;
  source?: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface PaginatedLeads {
  data: Lead[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Database-independent operations needed by the lead service. */
export interface LeadRepository {
  create(input: CreateLeadInput): Promise<Lead>;
  findAll(filters: LeadFilters): Promise<PaginatedLeads>;
  findById(id: string): Promise<Lead | null>;
  update(id: string, input: LeadUpdateInput): Promise<Lead | null>;
  delete(id: string): Promise<boolean>;
}
