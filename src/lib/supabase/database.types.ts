
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ad_config_versions": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"created_by": string,"id": string,"university_id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "config": NonNullable<Json>,"created_at"?: string,"created_by": string,"id"?: string,"university_id": string,"updated_at"?: string,"version": number
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string,"id"?: string,"university_id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_config_versions_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"ad_formats": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"injection_mode": string,"is_pop_style": boolean,"key": string,"needs_consent": boolean,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"injection_mode": string,"is_pop_style": boolean,"key": string,"needs_consent": boolean,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"injection_mode"?: string,"is_pop_style"?: boolean,"key"?: string,"needs_consent"?: boolean,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_formats_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"ad_impressions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"creative_id": string | null,"event_type": string,"id": string,"occurred_at": string,"placement_id": string,"university_id": string,"updated_at": string,"visitor_hash": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"creative_id"?: string | null,"event_type": string,"id"?: string,"occurred_at": string,"placement_id": string,"university_id": string,"updated_at"?: string,"visitor_hash"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"creative_id"?: string | null,"event_type"?: string,"id"?: string,"occurred_at"?: string,"placement_id"?: string,"university_id"?: string,"updated_at"?: string,"visitor_hash"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_impressions_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"ad_kill_switches": {
                  Row: {
                    "created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"is_global": boolean,"network_id": string | null,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"is_global"?: boolean,"network_id"?: string | null,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"is_global"?: boolean,"network_id"?: string | null,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_kill_switches_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"ad_networks": {
                  Row: {
                    "created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"key": string,"name": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"key": string,"name": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"key"?: string,"name"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_networks_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"ad_placements": {
                  Row: {
                    "created_at": string,"created_by": string | null,"enabled": boolean,"format_id": string,"frequency_cap": number | null,"id": string,"isolation_mode": string,"network_id": string,"page_type_id": string,"priority": number,"slot_key": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"format_id": string,"frequency_cap"?: number | null,"id"?: string,"isolation_mode"?: string,"network_id": string,"page_type_id": string,"priority"?: number,"slot_key": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"format_id"?: string,"frequency_cap"?: number | null,"id"?: string,"isolation_mode"?: string,"network_id"?: string,"page_type_id"?: string,"priority"?: number,"slot_key"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_placements_page_type_id_tenant_fk"
      columns: ["university_id","page_type_id"]
isOneToOne: false
      referencedRelation: "page_types"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "ad_placements_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "author_id": string,"body_html": string,"created_at": string,"created_by": string | null,"id": string,"section_id": string,"title": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body_html": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"section_id": string,"title": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"body_html"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"section_id"?: string,"title"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"assessments": {
                  Row: {
                    "assessment_type": string,"created_at": string,"created_by": string | null,"id": string,"offering_id": string,"section_id": string | null,"title": string,"total": number,"university_id": string,"updated_at": string,"visibility": string,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "assessment_type": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id": string,"section_id"?: string | null,"title": string,"total": number,"university_id": string,"updated_at"?: string,"visibility"?: string,"weight": number
                  }
                  Update: {
                    "assessment_type"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id"?: string,"section_id"?: string | null,"title"?: string,"total"?: number,"university_id"?: string,"updated_at"?: string,"visibility"?: string,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "assessments_offering_id_tenant_fk"
      columns: ["university_id","offering_id"]
isOneToOne: false
      referencedRelation: "course_offerings"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "assessments_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"attribution_rules": {
                  Row: {
                    "attribution": string,"created_at": string,"created_by": string | null,"effective_from": string,"entity_type": string,"id": string,"page_type": string,"university_id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "attribution": string,"created_at"?: string,"created_by"?: string | null,"effective_from": string,"entity_type": string,"id"?: string,"page_type": string,"university_id": string,"updated_at"?: string,"version": number
                  }
                  Update: {
                    "attribution"?: string,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"entity_type"?: string,"id"?: string,"page_type"?: string,"university_id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "attribution_rules_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"period_id": string,"slot_id": string,"status": string,"student_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"period_id": string,"slot_id": string,"status"?: string,"student_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"period_id"?: string,"slot_id"?: string,"status"?: string,"student_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_period_id_tenant_fk"
      columns: ["university_id","period_id"]
isOneToOne: false
      referencedRelation: "evaluation_periods"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "bookings_slot_id_tenant_fk"
      columns: ["university_id","slot_id"]
isOneToOne: false
      referencedRelation: "slots"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "bookings_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"consent_records": {
                  Row: {
                    "anonymous_key_hash": string | null,"categories": NonNullable<Json>,"created_at": string,"created_by": string | null,"id": string,"policy_version": string,"profile_id": string | null,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anonymous_key_hash"?: string | null,"categories": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"policy_version": string,"profile_id"?: string | null,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "anonymous_key_hash"?: string | null,"categories"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"policy_version"?: string,"profile_id"?: string | null,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consent_records_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"course_offerings": {
                  Row: {
                    "course_id": string,"created_at": string,"created_by": string | null,"id": string,"offering_code": string,"term_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "course_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_code": string,"term_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "course_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_code"?: string,"term_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "course_offerings_course_id_tenant_fk"
      columns: ["university_id","course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "course_offerings_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"courses": {
                  Row: {
                    "code": string,"created_at": string,"created_by": string | null,"department_id": string | null,"description": string,"id": string,"publication_state": string,"title": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"created_by"?: string | null,"department_id"?: string | null,"description"?: string,"id"?: string,"publication_state"?: string,"title": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"created_by"?: string | null,"department_id"?: string | null,"description"?: string,"id"?: string,"publication_state"?: string,"title"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courses_department_id_tenant_fk"
      columns: ["university_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "courses_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"slug": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"slug": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"slug"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "departments_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"earnings_entries": {
                  Row: {
                    "amount_minor": number,"created_at": string,"created_by": string | null,"currency_code": string,"id": string,"idempotency_key": string,"month": string,"network_id": string,"statement_reference": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"created_at"?: string,"created_by"?: string | null,"currency_code": string,"id"?: string,"idempotency_key": string,"month": string,"network_id": string,"statement_reference": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"created_at"?: string,"created_by"?: string | null,"currency_code"?: string,"id"?: string,"idempotency_key"?: string,"month"?: string,"network_id"?: string,"statement_reference"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "earnings_entries_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"enrollments": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"profile_id": string,"section_id": string,"status": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"profile_id": string,"section_id": string,"status"?: string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"profile_id"?: string,"section_id"?: string,"status"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrollments_section_id_tenant_fk"
      columns: ["university_id","section_id"]
isOneToOne: false
      referencedRelation: "sections"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "enrollments_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"evaluation_periods": {
                  Row: {
                    "allow_swaps": boolean,"created_at": string,"created_by": string | null,"cutoff_hours": number,"ends_at": string,"id": string,"offering_id": string,"section_id": string,"starts_at": string,"title": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_swaps"?: boolean,"created_at"?: string,"created_by"?: string | null,"cutoff_hours"?: number,"ends_at": string,"id"?: string,"offering_id": string,"section_id": string,"starts_at": string,"title": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "allow_swaps"?: boolean,"created_at"?: string,"created_by"?: string | null,"cutoff_hours"?: number,"ends_at"?: string,"id"?: string,"offering_id"?: string,"section_id"?: string,"starts_at"?: string,"title"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evaluation_periods_offering_id_tenant_fk"
      columns: ["university_id","offering_id"]
isOneToOne: false
      referencedRelation: "course_offerings"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "evaluation_periods_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_flags": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"key": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"key": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"key"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_flags_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"grading_scales": {
                  Row: {
                    "created_at": string,"created_by": string | null,"definition": NonNullable<Json>,"id": string,"name": string,"scale_type": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"definition": NonNullable<Json>,"id"?: string,"name": string,"scale_type": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"definition"?: NonNullable<Json>,"id"?: string,"name"?: string,"scale_type"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grading_scales_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "assessment_id": string,"created_at": string,"created_by": string,"expires_at": string,"id": string,"idempotency_key": string,"overwrite_existing": boolean,"state": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assessment_id": string,"created_at"?: string,"created_by": string,"expires_at": string,"id"?: string,"idempotency_key": string,"overwrite_existing"?: boolean,"state": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "assessment_id"?: string,"created_at"?: string,"created_by"?: string,"expires_at"?: string,"id"?: string,"idempotency_key"?: string,"overwrite_existing"?: boolean,"state"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_assessment_id_tenant_fk"
      columns: ["university_id","assessment_id"]
isOneToOne: false
      referencedRelation: "assessments"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "import_batches_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"import_rows": {
                  Row: {
                    "batch_id": string,"created_at": string,"created_by": string | null,"email": string | null,"error_code": string | null,"id": string,"proposed_score": number | null,"row_hash": string,"row_number": number,"status": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"error_code"?: string | null,"id"?: string,"proposed_score"?: number | null,"row_hash": string,"row_number": number,"status": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "batch_id"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"error_code"?: string | null,"id"?: string,"proposed_score"?: number | null,"row_hash"?: string,"row_number"?: number,"status"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rows_batch_id_tenant_fk"
      columns: ["university_id","batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "import_rows_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"invites": {
                  Row: {
                    "consumed_at": string | null,"created_at": string,"created_by": string | null,"email": string,"expires_at": string,"id": string,"role_id": string,"token_hash": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"email": string,"expires_at": string,"id"?: string,"role_id": string,"token_hash": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "consumed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string,"expires_at"?: string,"id"?: string,"role_id"?: string,"token_hash"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"mark_history": {
                  Row: {
                    "actor_id": string,"created_at": string,"created_by": string | null,"id": string,"mark_id": string,"new_score": number | null,"old_score": number | null,"reason": string,"source": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"mark_id": string,"new_score"?: number | null,"old_score"?: number | null,"reason": string,"source": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"mark_id"?: string,"new_score"?: number | null,"old_score"?: number | null,"reason"?: string,"source"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mark_history_mark_id_tenant_fk"
      columns: ["university_id","mark_id"]
isOneToOne: false
      referencedRelation: "marks"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "mark_history_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"marks": {
                  Row: {
                    "assessment_id": string,"created_at": string,"created_by": string | null,"id": string,"score": number | null,"status": string,"student_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assessment_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"score"?: number | null,"status"?: string,"student_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "assessment_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"score"?: number | null,"status"?: string,"student_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "marks_assessment_id_tenant_fk"
      columns: ["university_id","assessment_id"]
isOneToOne: false
      referencedRelation: "assessments"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "marks_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"offering_staff": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"offering_id": string,"profile_id": string,"staff_role": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id": string,"profile_id": string,"staff_role": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id"?: string,"profile_id"?: string,"staff_role"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "offering_staff_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"page_types": {
                  Row: {
                    "created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"is_auth": boolean,"key": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"is_auth"?: boolean,"key": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"is_auth"?: boolean,"key"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_types_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"page_visits_daily": {
                  Row: {
                    "created_at": string,"created_by": string | null,"entity_id": string | null,"entity_type": string | null,"id": string,"page_type": string,"unique_visits": number,"university_id": string,"updated_at": string,"visited_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"page_type": string,"unique_visits": number,"university_id": string,"updated_at"?: string,"visited_on": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"page_type"?: string,"unique_visits"?: number,"university_id"?: string,"updated_at"?: string,"visited_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_visits_daily_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"page_visits_raw": {
                  Row: {
                    "course_id": string | null,"created_at": string,"created_by": string | null,"entity_id": string | null,"entity_type": string | null,"id": string,"offering_id": string | null,"page_type": string,"ta_id": string | null,"university_id": string,"updated_at": string,"visited_on": string,"visitor_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "course_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"offering_id"?: string | null,"page_type": string,"ta_id"?: string | null,"university_id": string,"updated_at"?: string,"visited_on": string,"visitor_hash": string
                  }
                  Update: {
                    "course_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"offering_id"?: string | null,"page_type"?: string,"ta_id"?: string | null,"university_id"?: string,"updated_at"?: string,"visited_on"?: string,"visitor_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_visits_raw_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"payout_accounts": {
                  Row: {
                    "account_name": string,"account_reference_ciphertext": string,"created_at": string,"created_by": string | null,"id": string,"method": string,"profile_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_name": string,"account_reference_ciphertext": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method": string,"profile_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_name"?: string,"account_reference_ciphertext"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method"?: string,"profile_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payout_accounts_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"payout_events": {
                  Row: {
                    "actor_id": string,"created_at": string,"created_by": string | null,"event_type": string,"id": string,"payout_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"created_by"?: string | null,"event_type": string,"id"?: string,"payout_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"created_by"?: string | null,"event_type"?: string,"id"?: string,"payout_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payout_events_payout_id_tenant_fk"
      columns: ["university_id","payout_id"]
isOneToOne: false
      referencedRelation: "payouts"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "payout_events_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"payouts": {
                  Row: {
                    "amount_minor": number,"created_at": string,"created_by": string | null,"currency_code": string,"id": string,"profile_id": string,"proof_reference": string | null,"status": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"created_at"?: string,"created_by"?: string | null,"currency_code": string,"id"?: string,"profile_id": string,"proof_reference"?: string | null,"status"?: string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"created_at"?: string,"created_by"?: string | null,"currency_code"?: string,"id"?: string,"profile_id"?: string,"proof_reference"?: string | null,"status"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payouts_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"permissions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string,"id": string,"key": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description": string,"id"?: string,"key": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"key"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "permissions_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"created_by": string | null,"granted_by": string | null,"id": string,"profile_id": string,"revoked_at": string | null,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"granted_by"?: string | null,"id"?: string,"profile_id": string,"revoked_at"?: string | null,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"granted_by"?: string | null,"id"?: string,"profile_id"?: string,"revoked_at"?: string | null,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_admins_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_settings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"key": string,"schema_version": number,"university_id": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"key": string,"schema_version"?: number,"university_id": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"key"?: string,"schema_version"?: number,"university_id"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_settings_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "auth_user_id": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"display_name": string,"email": string,"github_public": boolean,"github_url": string | null,"id": string,"linkedin_public": boolean,"linkedin_url": string | null,"roll_no": string | null,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"display_name": string,"email": string,"github_public"?: boolean,"github_url"?: string | null,"id"?: string,"linkedin_public"?: boolean,"linkedin_url"?: string | null,"roll_no"?: string | null,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "auth_user_id"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"display_name"?: string,"email"?: string,"github_public"?: boolean,"github_url"?: string | null,"id"?: string,"linkedin_public"?: boolean,"linkedin_url"?: string | null,"roll_no"?: string | null,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"revenue_allocations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency_code": string,"id": string,"input_snapshot": NonNullable<Json>,"model_snapshot": NonNullable<Json>,"month": string,"platform_amount_minor": number,"profile_id": string | null,"ta_amount_minor": number,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency_code": string,"id"?: string,"input_snapshot": NonNullable<Json>,"model_snapshot": NonNullable<Json>,"month": string,"platform_amount_minor": number,"profile_id"?: string | null,"ta_amount_minor": number,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency_code"?: string,"id"?: string,"input_snapshot"?: NonNullable<Json>,"model_snapshot"?: NonNullable<Json>,"month"?: string,"platform_amount_minor"?: number,"profile_id"?: string | null,"ta_amount_minor"?: number,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "revenue_allocations_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"revenue_share_models": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency_code": string,"effective_from": string,"id": string,"model_type": string,"rate_per_thousand_minor": number | null,"share_basis_points": number,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency_code": string,"effective_from": string,"id"?: string,"model_type": string,"rate_per_thousand_minor"?: number | null,"share_basis_points": number,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency_code"?: string,"effective_from"?: string,"id"?: string,"model_type"?: string,"rate_per_thousand_minor"?: number | null,"share_basis_points"?: number,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "revenue_share_models_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"role_assignment_history": {
                  Row: {
                    "action": string,"actor_id": string,"after_state": string | null,"before_state": string | null,"created_at": string,"created_by": string | null,"id": string,"role_assignment_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"after_state"?: string | null,"before_state"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"role_assignment_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"after_state"?: string | null,"before_state"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"role_assignment_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_assignment_history_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"role_assignments": {
                  Row: {
                    "assigned_by": string,"created_at": string,"created_by": string | null,"id": string,"offering_id": string | null,"profile_id": string,"revoked_at": string | null,"role_id": string,"section_id": string | null,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_by": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id"?: string | null,"profile_id": string,"revoked_at"?: string | null,"role_id": string,"section_id"?: string | null,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_by"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id"?: string | null,"profile_id"?: string,"revoked_at"?: string | null,"role_id"?: string,"section_id"?: string | null,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_assignments_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"role_permissions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"permission_id": string,"role_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"permission_id": string,"role_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"permission_id"?: string,"role_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"roles": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"scope": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"scope": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"scope"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "roles_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"sections": {
                  Row: {
                    "capacity": number | null,"created_at": string,"created_by": string | null,"id": string,"offering_id": string,"section_code": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id": string,"section_code": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"offering_id"?: string,"section_code"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sections_offering_id_tenant_fk"
      columns: ["university_id","offering_id"]
isOneToOne: false
      referencedRelation: "course_offerings"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "sections_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"slots": {
                  Row: {
                    "capacity": number,"created_at": string,"created_by": string | null,"ends_at": string,"id": string,"location": string | null,"period_id": string,"starts_at": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity": number,"created_at"?: string,"created_by"?: string | null,"ends_at": string,"id"?: string,"location"?: string | null,"period_id": string,"starts_at": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string,"id"?: string,"location"?: string | null,"period_id"?: string,"starts_at"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slots_period_id_tenant_fk"
      columns: ["university_id","period_id"]
isOneToOne: false
      referencedRelation: "evaluation_periods"
      referencedColumns: ["university_id","id"]
    },{
      foreignKeyName: "slots_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"sponsor_creatives": {
                  Row: {
                    "created_at": string,"created_by": string | null,"ends_at": string,"id": string,"image_url": string,"sponsor_id": string,"starts_at": string,"target_url": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"ends_at": string,"id"?: string,"image_url": string,"sponsor_id": string,"starts_at": string,"target_url": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"ends_at"?: string,"id"?: string,"image_url"?: string,"sponsor_id"?: string,"starts_at"?: string,"target_url"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sponsor_creatives_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"sponsor_slots": {
                  Row: {
                    "created_at": string,"created_by": string | null,"creative_id": string,"id": string,"page_type_id": string,"priority": number,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"creative_id": string,"id"?: string,"page_type_id": string,"priority"?: number,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"creative_id"?: string,"id"?: string,"page_type_id"?: string,"priority"?: number,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sponsor_slots_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"sponsors": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"is_active": boolean,"name": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sponsors_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"swap_requests": {
                  Row: {
                    "accepted_by": string | null,"created_at": string,"created_by": string | null,"from_booking_id": string,"id": string,"requested_by": string,"status": string,"to_booking_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"from_booking_id": string,"id"?: string,"requested_by": string,"status"?: string,"to_booking_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"from_booking_id"?: string,"id"?: string,"requested_by"?: string,"status"?: string,"to_booking_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "swap_requests_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"terms": {
                  Row: {
                    "created_at": string,"created_by": string | null,"ends_on": string,"id": string,"name": string,"publication_state": string,"starts_on": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"ends_on": string,"id"?: string,"name": string,"publication_state"?: string,"starts_on": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"ends_on"?: string,"id"?: string,"name"?: string,"publication_state"?: string,"starts_on"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "terms_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"universities": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"is_enabled": boolean,"name": string,"settings": NonNullable<Json>,"slug": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_enabled"?: boolean,"name": string,"settings"?: NonNullable<Json>,"slug": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_enabled"?: boolean,"name"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"university_domains": {
                  Row: {
                    "created_at": string,"created_by": string | null,"domain": string,"id": string,"is_allowed": boolean,"is_verified": boolean,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"domain": string,"id"?: string,"is_allowed"?: boolean,"is_verified"?: boolean,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"domain"?: string,"id"?: string,"is_allowed"?: boolean,"is_verified"?: boolean,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "university_domains_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"university_memberships": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"profile_id": string,"status": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"profile_id": string,"status": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"profile_id"?: string,"status"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "university_memberships_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"waitlist_entries": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"position": number,"slot_id": string,"status": string,"student_id": string,"university_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"position": number,"slot_id": string,"status"?: string,"student_id": string,"university_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"position"?: number,"slot_id"?: string,"status"?: string,"student_id"?: string,"university_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waitlist_entries_university_fk"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "ad_config_snapshot":
{ Args: { "p_university_id": string }; Returns: Json
                           },
"ad_kill_state":
{ Args: { "p_university_id": string }; Returns: Json
                           },
"book_slot":
{ Args: { "p_period_id": string,"p_slot_id": string,"p_university_id": string }; Returns: string
                           },
"cancel_booking":
{ Args: { "p_booking_id": string }; Returns: string
                           },
"confirm_mark_import":
{ Args: { "p_batch_id": string }; Returns: Json
                           },
"offering_analytics":
{ Args: { "p_offering_id": string }; Returns: Json
                           },
"offering_marksheet":
{ Args: { "p_offering_id": string }; Returns: Json
                           },
"period_booking_overview":
{ Args: { "p_period_id": string }; Returns: Json
                           },
"student_dashboard":
{ Args: Record<PropertyKey, never>; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
