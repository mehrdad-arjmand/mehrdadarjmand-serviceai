export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      chunks: {
        Row: {
          chunk_index: number
          created_at: string | null
          document_id: string | null
          embedding: string | null
          equipment: string | null
          fault_code: string | null
          id: string
          site: string | null
          text: string
        }
        Insert: {
          chunk_index: number
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          equipment?: string | null
          fault_code?: string | null
          id?: string
          site?: string | null
          text: string
        }
        Update: {
          chunk_index?: number
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          equipment?: string | null
          fault_code?: string | null
          id?: string
          site?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          doc_type: string | null
          equipment_make: string | null
          equipment_model: string | null
          filename: string
          id: string
          ingested_chunks: number | null
          ingestion_error: string | null
          ingestion_status: string | null
          page_count: number | null
          site: string | null
          total_chunks: number | null
          upload_date: string | null
          uploaded_at: string | null
        }
        Insert: {
          doc_type?: string | null
          equipment_make?: string | null
          equipment_model?: string | null
          filename: string
          id?: string
          ingested_chunks?: number | null
          ingestion_error?: string | null
          ingestion_status?: string | null
          page_count?: number | null
          site?: string | null
          total_chunks?: number | null
          upload_date?: string | null
          uploaded_at?: string | null
        }
        Update: {
          doc_type?: string | null
          equipment_make?: string | null
          equipment_model?: string | null
          filename?: string
          id?: string
          ingested_chunks?: number | null
          ingestion_error?: string | null
          ingestion_status?: string | null
          page_count?: number | null
          site?: string | null
          total_chunks?: number | null
          upload_date?: string | null
          uploaded_at?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          assistant_delete: boolean
          assistant_read: boolean
          assistant_write: boolean
          created_at: string | null
          description: string | null
          id: string
          repository_delete: boolean
          repository_read: boolean
          repository_write: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
        }
        Insert: {
          assistant_delete?: boolean
          assistant_read?: boolean
          assistant_write?: boolean
          created_at?: string | null
          description?: string | null
          id?: string
          repository_delete?: boolean
          repository_read?: boolean
          repository_write?: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
        }
        Update: {
          assistant_delete?: boolean
          assistant_read?: boolean
          assistant_write?: boolean
          created_at?: string | null
          description?: string | null
          id?: string
          repository_delete?: boolean
          repository_read?: boolean
          repository_write?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_user_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      create_role: {
        Args: {
          p_assistant_delete?: boolean
          p_assistant_read?: boolean
          p_assistant_write?: boolean
          p_description?: string
          p_repository_delete?: boolean
          p_repository_read?: boolean
          p_repository_write?: boolean
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
      delete_role: {
        Args: { p_role: Database["public"]["Enums"]["app_role"] }
        Returns: undefined
      }
      get_all_roles: {
        Args: never
        Returns: {
          assistant_delete: boolean
          assistant_read: boolean
          assistant_write: boolean
          description: string
          repository_delete: boolean
          repository_read: boolean
          repository_write: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_count: number
        }[]
      }
      get_user_permissions: {
        Args: { p_user_id?: string }
        Returns: {
          assistant_delete: boolean
          assistant_read: boolean
          assistant_write: boolean
          repository_delete: boolean
          repository_read: boolean
          repository_write: boolean
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      has_permission: {
        Args: { p_action: string; p_tab: string; p_user_id?: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      list_users_with_roles: {
        Args: never
        Returns: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
          role_assigned_at: string
          user_id: string
        }[]
      }
      match_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          document_id: string
          equipment: string
          fault_code: string
          filename: string
          id: string
          similarity: number
          site: string
          text: string
        }[]
      }
      update_role_permissions: {
        Args: {
          p_assistant_delete?: boolean
          p_assistant_read?: boolean
          p_assistant_write?: boolean
          p_description?: string
          p_repository_delete?: boolean
          p_repository_read?: boolean
          p_repository_write?: boolean
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user" | "manager" | "technician"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "manager", "technician"],
    },
  },
} as const
