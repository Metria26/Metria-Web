
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
            "announcements": {
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "confirm_mark_import":
{ Args: { "p_batch_id": string }; Returns: Json
                           },
"offering_analytics":
{ Args: { "p_offering_id": string }; Returns: Json
                           },
"offering_marksheet":
{ Args: { "p_offering_id": string }; Returns: Json
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
