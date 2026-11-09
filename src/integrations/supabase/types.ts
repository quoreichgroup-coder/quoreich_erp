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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_analysis_history: {
        Row: {
          analysis_type: string
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          inputs: Json
          params: Json
          result: Json
          status: string
          tenant_id: string
          trigger_source: string
        }
        Insert: {
          analysis_type: string
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          inputs?: Json
          params?: Json
          result?: Json
          status?: string
          tenant_id: string
          trigger_source?: string
        }
        Update: {
          analysis_type?: string
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          inputs?: Json
          params?: Json
          result?: Json
          status?: string
          tenant_id?: string
          trigger_source?: string
        }
        Relationships: []
      }
      ai_analysis_schedules: {
        Row: {
          analysis_type: string
          created_at: string
          created_by: string | null
          enabled: boolean
          frequency: string
          id: string
          last_run_at: string | null
          next_run_at: string
          params: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          analysis_type: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          frequency?: string
          id?: string
          last_run_at?: string | null
          next_run_at?: string
          params?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          analysis_type?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          frequency?: string
          id?: string
          last_run_at?: string | null
          next_run_at?: string
          params?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ap_approval_queue: {
        Row: {
          amount: number
          created_at: string
          doc_number: string
          doc_type: string
          id: string
          level: string
          request_date: string
          requester: string
          resolved_at: string | null
          resolved_by: string | null
          sla_hours: number
          status: string
          tenant_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          doc_number: string
          doc_type: string
          id?: string
          level: string
          request_date?: string
          requester: string
          resolved_at?: string | null
          resolved_by?: string | null
          sla_hours?: number
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          doc_number?: string
          doc_type?: string
          id?: string
          level?: string
          request_date?: string
          requester?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sla_hours?: number
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ap_approval_thresholds: {
        Row: {
          approver: string
          created_at: string
          doc_types: string
          id: string
          level: string
          max_amount: number | null
          sla_hours: number
          tenant_id: string
        }
        Insert: {
          approver: string
          created_at?: string
          doc_types: string
          id?: string
          level: string
          max_amount?: number | null
          sla_hours?: number
          tenant_id: string
        }
        Update: {
          approver?: string
          created_at?: string
          doc_types?: string
          id?: string
          level?: string
          max_amount?: number | null
          sla_hours?: number
          tenant_id?: string
        }
        Relationships: []
      }
      ap_general_settings: {
        Row: {
          default_currency: string | null
          default_payment_method: string | null
          discount_window_days: number | null
          early_payment_discount_pct: number | null
          po_required: string | null
          tenant_id: string
          three_way_match: boolean | null
          updated_at: string
        }
        Insert: {
          default_currency?: string | null
          default_payment_method?: string | null
          discount_window_days?: number | null
          early_payment_discount_pct?: number | null
          po_required?: string | null
          tenant_id: string
          three_way_match?: boolean | null
          updated_at?: string
        }
        Update: {
          default_currency?: string | null
          default_payment_method?: string | null
          discount_window_days?: number | null
          early_payment_discount_pct?: number | null
          po_required?: string | null
          tenant_id?: string
          three_way_match?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      ap_invoices: {
        Row: {
          amount_paid: number
          approval_status: string
          created_at: string
          created_by: string
          due_date: string
          id: string
          invoice_date: string
          invoice_number: string
          journal_entry_id: string | null
          po_id: string | null
          status: string
          subtotal: number
          supplier_id: string
          tax_amount: number
          tenant_id: string
          total: number
        }
        Insert: {
          amount_paid?: number
          approval_status?: string
          created_at?: string
          created_by: string
          due_date: string
          id?: string
          invoice_date?: string
          invoice_number: string
          journal_entry_id?: string | null
          po_id?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          tax_amount?: number
          tenant_id: string
          total?: number
        }
        Update: {
          amount_paid?: number
          approval_status?: string
          created_at?: string
          created_by?: string
          due_date?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          journal_entry_id?: string | null
          po_id?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          tax_amount?: number
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "ap_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "po_three_way_match"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "ap_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "procurement_sla_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "ap_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "three_way_match_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "ap_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ap_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ap_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_notification_rules: {
        Row: {
          channel: string
          created_at: string
          event: string
          id: string
          is_active: boolean
          recipients: string
          tenant_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          event: string
          id?: string
          is_active?: boolean
          recipients: string
          tenant_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          event?: string
          id?: string
          is_active?: boolean
          recipients?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ap_numbering_series: {
        Row: {
          created_at: string
          doc_type: string
          format: string
          id: string
          next_number: number
          prefix: string
          reset_frequency: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          format?: string
          id?: string
          next_number?: number
          prefix: string
          reset_frequency?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          format?: string
          id?: string
          next_number?: number
          prefix?: string
          reset_frequency?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ap_payment_methods: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          tenant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          tenant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ap_withholding_rates: {
        Row: {
          category: string
          created_at: string
          gl_account: string | null
          id: string
          is_active: boolean
          rate_pct: number
          tenant_id: string
        }
        Insert: {
          category: string
          created_at?: string
          gl_account?: string | null
          id?: string
          is_active?: boolean
          rate_pct?: number
          tenant_id: string
        }
        Update: {
          category?: string
          created_at?: string
          gl_account?: string | null
          id?: string
          is_active?: boolean
          rate_pct?: number
          tenant_id?: string
        }
        Relationships: []
      }
      ar_dunning_rules: {
        Row: {
          action: string
          created_at: string
          days_overdue: number
          fee_amount: number
          id: string
          is_active: boolean
          level: number
          template: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          days_overdue: number
          fee_amount?: number
          id?: string
          is_active?: boolean
          level: number
          template?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          days_overdue?: number
          fee_amount?: number
          id?: string
          is_active?: boolean
          level?: number
          template?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      ar_general_settings: {
        Row: {
          auto_numbering: boolean | null
          default_credit_limit: number | null
          default_currency: string | null
          default_payment_term_code: string | null
          grace_period_days: number | null
          late_payment_interest_pct: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_numbering?: boolean | null
          default_credit_limit?: number | null
          default_currency?: string | null
          default_payment_term_code?: string | null
          grace_period_days?: number | null
          late_payment_interest_pct?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_numbering?: boolean | null
          default_credit_limit?: number | null
          default_currency?: string | null
          default_payment_term_code?: string | null
          grace_period_days?: number | null
          late_payment_interest_pct?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ar_invoices: {
        Row: {
          amount_paid: number
          created_at: string
          created_by: string
          customer_id: string
          dn_id: string | null
          due_date: string
          id: string
          invoice_date: string
          invoice_number: string
          journal_entry_id: string | null
          so_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          tenant_id: string
          total: number
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          created_by: string
          customer_id: string
          dn_id?: string | null
          due_date: string
          id?: string
          invoice_date?: string
          invoice_number: string
          journal_entry_id?: string | null
          so_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          total?: number
        }
        Update: {
          amount_paid?: number
          created_at?: string
          created_by?: string
          customer_id?: string
          dn_id?: string | null
          due_date?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          journal_entry_id?: string | null
          so_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "ar_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ar_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_invoices_dn_id_fkey"
            columns: ["dn_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "ar_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_invoices_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["so_id"]
          },
          {
            foreignKeyName: "ar_invoices_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_invoices_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_sla_view"
            referencedColumns: ["so_id"]
          },
          {
            foreignKeyName: "ar_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ar_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ar_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_notification_log: {
        Row: {
          channel: string
          customer_id: string | null
          customer_name: string | null
          detail: string | null
          id: string
          rule_id: string | null
          sent_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          channel: string
          customer_id?: string | null
          customer_name?: string | null
          detail?: string | null
          id?: string
          rule_id?: string | null
          sent_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          channel?: string
          customer_id?: string | null
          customer_name?: string | null
          detail?: string | null
          id?: string
          rule_id?: string | null
          sent_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ar_notification_rules: {
        Row: {
          channel: string
          created_at: string
          id: string
          is_active: boolean
          last_triggered_at: string | null
          recipients: string
          tenant_id: string
          trigger_condition: string
          trigger_count: number
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          recipients: string
          tenant_id: string
          trigger_condition: string
          trigger_count?: number
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          recipients?: string
          tenant_id?: string
          trigger_condition?: string
          trigger_count?: number
        }
        Relationships: []
      }
      ar_numbering_series: {
        Row: {
          created_at: string
          doc_type: string
          format: string
          id: string
          next_number: number
          prefix: string
          reset_frequency: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          format?: string
          id?: string
          next_number?: number
          prefix: string
          reset_frequency?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          format?: string
          id?: string
          next_number?: number
          prefix?: string
          reset_frequency?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ar_payment_terms: {
        Row: {
          code: string
          created_at: string
          days: number
          discount_percent: number
          id: string
          is_active: boolean
          label: string
          tenant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          days?: number
          discount_percent?: number
          id?: string
          is_active?: boolean
          label: string
          tenant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          days?: number
          discount_percent?: number
          id?: string
          is_active?: boolean
          label?: string
          tenant_id?: string
        }
        Relationships: []
      }
      asset_categories: {
        Row: {
          created_at: string
          depreciation_method: string
          gl_asset_account_id: string | null
          gl_depreciation_account_id: string | null
          gl_expense_account_id: string | null
          id: string
          name: string
          tenant_id: string
          useful_life_years: number
        }
        Insert: {
          created_at?: string
          depreciation_method?: string
          gl_asset_account_id?: string | null
          gl_depreciation_account_id?: string | null
          gl_expense_account_id?: string | null
          id?: string
          name: string
          tenant_id: string
          useful_life_years?: number
        }
        Update: {
          created_at?: string
          depreciation_method?: string
          gl_asset_account_id?: string | null
          gl_depreciation_account_id?: string | null
          gl_expense_account_id?: string | null
          id?: string
          name?: string
          tenant_id?: string
          useful_life_years?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_categories_gl_asset_account_id_fkey"
            columns: ["gl_asset_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_gl_asset_account_id_fkey"
            columns: ["gl_asset_account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "asset_categories_gl_asset_account_id_fkey"
            columns: ["gl_asset_account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "asset_categories_gl_depreciation_account_id_fkey"
            columns: ["gl_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_gl_depreciation_account_id_fkey"
            columns: ["gl_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "asset_categories_gl_depreciation_account_id_fkey"
            columns: ["gl_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "asset_categories_gl_expense_account_id_fkey"
            columns: ["gl_expense_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_gl_expense_account_id_fkey"
            columns: ["gl_expense_account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "asset_categories_gl_expense_account_id_fkey"
            columns: ["gl_expense_account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "asset_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "asset_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "asset_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_disposals: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string
          disposal_date: string
          disposal_type: string
          gain_loss: number
          id: string
          journal_entry_id: string | null
          net_book_value_at_disposal: number
          notes: string | null
          sale_price: number
          tenant_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string
          disposal_date: string
          disposal_type?: string
          gain_loss?: number
          id?: string
          journal_entry_id?: string | null
          net_book_value_at_disposal?: number
          notes?: string | null
          sale_price?: number
          tenant_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string
          disposal_date?: string
          disposal_type?: string
          gain_loss?: number
          id?: string
          journal_entry_id?: string | null
          net_book_value_at_disposal?: number
          notes?: string | null
          sale_price?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_disposals_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_disposals_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets_register_view"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      assets: {
        Row: {
          accumulated_depreciation: number
          acquisition_cost: number
          acquisition_date: string
          asset_code: string
          assigned_to: string | null
          category_id: string | null
          created_at: string
          created_by: string
          depreciation_method: string
          disposal_amount: number | null
          disposal_date: string | null
          id: string
          location: string | null
          name: string
          net_book_value: number
          next_maintenance: string | null
          salvage_value: number
          status: string
          tenant_id: string
          useful_life_months: number
          warranty_expiry: string | null
        }
        Insert: {
          accumulated_depreciation?: number
          acquisition_cost?: number
          acquisition_date: string
          asset_code: string
          assigned_to?: string | null
          category_id?: string | null
          created_at?: string
          created_by: string
          depreciation_method?: string
          disposal_amount?: number | null
          disposal_date?: string | null
          id?: string
          location?: string | null
          name: string
          net_book_value?: number
          next_maintenance?: string | null
          salvage_value?: number
          status?: string
          tenant_id: string
          useful_life_months?: number
          warranty_expiry?: string | null
        }
        Update: {
          accumulated_depreciation?: number
          acquisition_cost?: number
          acquisition_date?: string
          asset_code?: string
          assigned_to?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string
          depreciation_method?: string
          disposal_amount?: number | null
          disposal_date?: string | null
          id?: string
          location?: string | null
          name?: string
          net_book_value?: number
          next_maintenance?: string | null
          salvage_value?: number
          status?: string
          tenant_id?: string
          useful_life_months?: number
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          account_type: string
          balance: number
          bank_name: string
          created_at: string
          currency: string
          gl_account_id: string | null
          id: string
          is_active: boolean
          last_reconciled_at: string | null
          name: string
          tenant_id: string
        }
        Insert: {
          account_number?: string | null
          account_type?: string
          balance?: number
          bank_name: string
          created_at?: string
          currency?: string
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          last_reconciled_at?: string | null
          name: string
          tenant_id: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          balance?: number
          bank_name?: string
          created_at?: string
          currency?: string
          gl_account_id?: string | null
          id?: string
          is_active?: boolean
          last_reconciled_at?: string | null
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "bank_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliations: {
        Row: {
          bank_account_id: string
          bank_balance: number
          book_balance: number
          created_at: string
          difference: number | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          status: string
          tenant_id: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          bank_account_id: string
          bank_balance?: number
          book_balance?: number
          created_at?: string
          difference?: number | null
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          status?: string
          tenant_id: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          bank_account_id?: string
          bank_balance?: number
          book_balance?: number
          created_at?: string
          difference?: number | null
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_cash_position_view"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_reconciliations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_reconciliation_status_view"
            referencedColumns: ["bank_account_id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          line_date: string
          matched_at: string | null
          matched_by: string | null
          matched_transaction_id: string | null
          reference: string | null
          statement_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          line_date: string
          matched_at?: string | null
          matched_by?: string | null
          matched_transaction_id?: string | null
          reference?: string | null
          statement_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          line_date?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_transaction_id?: string | null
          reference?: string | null
          statement_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statements: {
        Row: {
          bank_account_id: string
          closing_balance: number
          created_at: string
          file_name: string | null
          id: string
          imported_by: string | null
          opening_balance: number
          period_end: string
          period_start: string
          statement_date: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          closing_balance?: number
          created_at?: string
          file_name?: string | null
          id?: string
          imported_by?: string | null
          opening_balance?: number
          period_end: string
          period_start: string
          statement_date: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          closing_balance?: number
          created_at?: string
          file_name?: string | null
          id?: string
          imported_by?: string | null
          opening_balance?: number
          period_end?: string
          period_start?: string
          statement_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_cash_position_view"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_reconciliation_status_view"
            referencedColumns: ["bank_account_id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          description: string | null
          id: string
          is_reconciled: boolean
          payment_id: string | null
          reference: string | null
          tenant_id: string
          transaction_date: string
          transaction_type: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_reconciled?: boolean
          payment_id?: string | null
          reference?: string | null
          tenant_id: string
          transaction_date?: string
          transaction_type: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_reconciled?: boolean
          payment_id?: string | null
          reference?: string | null
          tenant_id?: string
          transaction_date?: string
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_cash_position_view"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_reconciliation_status_view"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          actual_amount: number
          budget_id: string
          created_at: string
          department: string | null
          gl_account_id: string | null
          id: string
          period: string
          planned_amount: number
          variance: number | null
        }
        Insert: {
          actual_amount?: number
          budget_id: string
          created_at?: string
          department?: string | null
          gl_account_id?: string | null
          id?: string
          period: string
          planned_amount?: number
          variance?: number | null
        }
        Update: {
          actual_amount?: number
          budget_id?: string
          created_at?: string
          department?: string | null
          gl_account_id?: string | null
          id?: string
          period?: string
          planned_amount?: number
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "budget_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
        ]
      }
      budget_role_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          details: Json
          id: string
          role: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          details?: Json
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          target_user_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          details?: Json
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          target_user_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          fiscal_year: string
          id: string
          name: string
          scenario: string
          status: string
          tenant_id: string
          total_amount: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          fiscal_year: string
          id?: string
          name: string
          scenario?: string
          status?: string
          tenant_id: string
          total_amount?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          fiscal_year?: string
          id?: string
          name?: string
          scenario?: string
          status?: string
          tenant_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_forecasts: {
        Row: {
          amount_actual: number
          amount_forecast: number
          bank_account_id: string | null
          category: string
          created_at: string
          created_by: string | null
          direction: string
          id: string
          notes: string | null
          source: string
          tenant_id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          amount_actual?: number
          amount_forecast?: number
          bank_account_id?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          direction: string
          id?: string
          notes?: string | null
          source?: string
          tenant_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          amount_actual?: number
          amount_forecast?: number
          bank_account_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          notes?: string | null
          source?: string
          tenant_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_forecasts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashflow_forecasts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_cash_position_view"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "cashflow_forecasts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "treasury_reconciliation_status_view"
            referencedColumns: ["bank_account_id"]
          },
        ]
      }
      compliance_controls: {
        Row: {
          category: string | null
          control_code: string
          created_at: string
          description: string | null
          framework_id: string
          id: string
          last_tested_at: string | null
          next_review_at: string | null
          owner: string | null
          risk_level: string | null
          status: string
          title: string
        }
        Insert: {
          category?: string | null
          control_code: string
          created_at?: string
          description?: string | null
          framework_id: string
          id?: string
          last_tested_at?: string | null
          next_review_at?: string | null
          owner?: string | null
          risk_level?: string | null
          status?: string
          title: string
        }
        Update: {
          category?: string | null
          control_code?: string
          created_at?: string
          description?: string | null
          framework_id?: string
          id?: string
          last_tested_at?: string | null
          next_review_at?: string | null
          owner?: string | null
          risk_level?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_controls_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "compliance_frameworks"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_frameworks: {
        Row: {
          compliant_controls: number
          created_at: string
          id: string
          name: string
          status: string
          tenant_id: string
          total_controls: number
          version: string | null
        }
        Insert: {
          compliant_controls?: number
          created_at?: string
          id?: string
          name: string
          status?: string
          tenant_id: string
          total_controls?: number
          version?: string | null
        }
        Update: {
          compliant_controls?: number
          created_at?: string
          id?: string
          name?: string
          status?: string
          tenant_id?: string
          total_controls?: number
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_frameworks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "compliance_frameworks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "compliance_frameworks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_role_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      compliance_test_logs: {
        Row: {
          control_id: string
          created_at: string
          duration: string | null
          findings: number
          id: string
          notes: string | null
          result: string
          test_date: string
          tester: string
        }
        Insert: {
          control_id: string
          created_at?: string
          duration?: string | null
          findings?: number
          id?: string
          notes?: string | null
          result: string
          test_date?: string
          tester: string
        }
        Update: {
          control_id?: string
          created_at?: string
          duration?: string | null
          findings?: number
          id?: string
          notes?: string | null
          result?: string
          test_date?: string
          tester?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_test_logs_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "compliance_controls"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          notes: string | null
          opportunity_id: string | null
          subject: string
          tenant_id: string
          type: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          subject: string
          tenant_id: string
          type?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          subject?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "crm_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          company: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          position: string | null
          source: string | null
          status: string
          tags: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          position?: string | null
          source?: string | null
          status?: string
          tags?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          position?: string | null
          source?: string | null
          status?: string
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_opportunities: {
        Row: {
          amount: number
          contact_id: string | null
          converted_quotation_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          expected_close_date: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string | null
          probability: number
          stage: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          contact_id?: string | null
          converted_quotation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          expected_close_date?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id?: string | null
          probability?: number
          stage?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          contact_id?: string | null
          converted_quotation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          expected_close_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
          probability?: number
          stage?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunities_converted_quotation_id_fkey"
            columns: ["converted_quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunities_converted_quotation_id_fkey"
            columns: ["converted_quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "crm_opportunities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_opportunities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_role_audit: {
        Row: {
          action: string
          created_at: string
          id: string
          performed_by: string | null
          reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          performed_by?: string | null
          reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          performed_by?: string | null
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          credit_limit: number | null
          email: string | null
          id: string
          name: string
          payment_terms: number | null
          phone: string | null
          status: string
          tax_id: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          credit_limit?: number | null
          email?: string | null
          id?: string
          name: string
          payment_terms?: number | null
          phone?: string | null
          status?: string
          tax_id?: string | null
          tenant_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          credit_limit?: number | null
          email?: string | null
          id?: string
          name?: string
          payment_terms?: number | null
          phone?: string | null
          status?: string
          tax_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_notes: {
        Row: {
          ar_invoice_id: string | null
          created_at: string
          created_by: string
          customer_id: string
          delivered_by: string | null
          delivery_date: string
          dn_number: string
          id: string
          notes: string | null
          so_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          ar_invoice_id?: string | null
          created_at?: string
          created_by: string
          customer_id: string
          delivered_by?: string | null
          delivery_date?: string
          dn_number: string
          id?: string
          notes?: string | null
          so_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          ar_invoice_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          delivered_by?: string | null
          delivery_date?: string
          dn_number?: string
          id?: string
          notes?: string | null
          so_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_ar_invoice_id_fkey"
            columns: ["ar_invoice_id"]
            isOneToOne: false
            referencedRelation: "ar_aging_view"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "delivery_notes_ar_invoice_id_fkey"
            columns: ["ar_invoice_id"]
            isOneToOne: false
            referencedRelation: "ar_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_ar_invoice_id_fkey"
            columns: ["ar_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["ar_invoice_id"]
          },
          {
            foreignKeyName: "delivery_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "delivery_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["so_id"]
          },
          {
            foreignKeyName: "delivery_notes_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_sla_view"
            referencedColumns: ["so_id"]
          },
        ]
      }
      depreciation_entries: {
        Row: {
          accumulated: number
          amount: number
          asset_id: string
          created_at: string
          id: string
          journal_entry_id: string | null
          net_book_value: number
          period_date: string
        }
        Insert: {
          accumulated: number
          amount: number
          asset_id: string
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          net_book_value: number
          period_date: string
        }
        Update: {
          accumulated?: number
          amount?: number
          asset_id?: string
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          net_book_value?: number
          period_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_entries_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_entries_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets_register_view"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "depreciation_entries_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "depreciation_entries_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      dn_lines: {
        Row: {
          created_at: string
          description: string | null
          dn_id: string
          id: string
          item_id: string | null
          quantity: number
          so_line_id: string | null
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          dn_id: string
          id?: string
          item_id?: string | null
          quantity?: number
          so_line_id?: string | null
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          dn_id?: string
          id?: string
          item_id?: string | null
          quantity?: number
          so_line_id?: string | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "dn_lines_dn_id_fkey"
            columns: ["dn_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "dn_lines_so_line_id_fkey"
            columns: ["so_line_id"]
            isOneToOne: false
            referencedRelation: "so_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account: string | null
          base_salary: number
          contract_type: string
          created_at: string
          currency: string
          department: string | null
          email: string | null
          end_date: string | null
          first_name: string
          hire_date: string
          id: string
          job_title: string | null
          last_name: string
          matricule: string
          phone: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bank_account?: string | null
          base_salary?: number
          contract_type?: string
          created_at?: string
          currency?: string
          department?: string | null
          email?: string | null
          end_date?: string | null
          first_name: string
          hire_date?: string
          id?: string
          job_title?: string | null
          last_name: string
          matricule: string
          phone?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bank_account?: string | null
          base_salary?: number
          contract_type?: string
          created_at?: string
          currency?: string
          department?: string | null
          email?: string | null
          end_date?: string | null
          first_name?: string
          hire_date?: string
          id?: string
          job_title?: string | null
          last_name?: string
          matricule?: string
          phone?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      erp_alerts: {
        Row: {
          action_required: boolean
          alert_type: string
          created_at: string
          id: string
          is_resolved: boolean
          message: string
          module: string
          read_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          tenant_id: string
          title: string
        }
        Insert: {
          action_required?: boolean
          alert_type: string
          created_at?: string
          id?: string
          is_resolved?: boolean
          message: string
          module: string
          read_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          tenant_id: string
          title: string
        }
        Update: {
          action_required?: boolean
          alert_type?: string
          created_at?: string
          id?: string
          is_resolved?: boolean
          message?: string
          module?: string
          read_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "erp_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "erp_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_permissions: {
        Row: {
          id: string
          module: string
          permission: string
          role_id: string
        }
        Insert: {
          id?: string
          module: string
          permission: string
          role_id: string
        }
        Update: {
          id?: string
          module?: string
          permission?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "erp_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "erp_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "erp_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_lines: {
        Row: {
          amount: number
          category: string
          description: string | null
          expense_date: string
          id: string
          receipt_url: string | null
          report_id: string
        }
        Insert: {
          amount: number
          category: string
          description?: string | null
          expense_date: string
          id?: string
          receipt_url?: string | null
          report_id: string
        }
        Update: {
          amount?: number
          category?: string
          description?: string | null
          expense_date?: string
          id?: string
          receipt_url?: string | null
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_lines_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "expense_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_reports: {
        Row: {
          approval_status: string
          created_at: string
          employee_id: string
          id: string
          journal_entry_id: string | null
          report_number: string
          status: string
          submission_date: string
          tenant_id: string
          total: number
        }
        Insert: {
          approval_status?: string
          created_at?: string
          employee_id: string
          id?: string
          journal_entry_id?: string | null
          report_number: string
          status?: string
          submission_date?: string
          tenant_id: string
          total?: number
        }
        Update: {
          approval_status?: string
          created_at?: string
          employee_id?: string
          id?: string
          journal_entry_id?: string | null
          report_number?: string
          status?: string
          submission_date?: string
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_reports_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "expense_reports_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "expense_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "expense_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_role_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      fixed_asset_role_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          details: Json | null
          id: string
          role: string | null
          target_user_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          role?: string | null
          target_user_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          role?: string | null
          target_user_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      gl_accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          tenant_id: string
        }
        Insert: {
          account_type?: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          tenant_id: string
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_audit_logs: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          details: string | null
          entry_id: string | null
          hash: string
          id: string
          prev_hash: string
          tenant_id: string
          user_name: string
        }
        Insert: {
          action: string
          batch_id: string
          created_at?: string
          details?: string | null
          entry_id?: string | null
          hash?: string
          id?: string
          prev_hash?: string
          tenant_id: string
          user_name?: string
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          details?: string | null
          entry_id?: string | null
          hash?: string
          id?: string
          prev_hash?: string
          tenant_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_audit_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "gl_audit_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          created_at: string
          gr_number: string
          id: string
          po_id: string
          receipt_date: string
          received_by: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          gr_number: string
          id?: string
          po_id: string
          receipt_date?: string
          received_by: string
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          gr_number?: string
          id?: string
          po_id?: string
          receipt_date?: string
          received_by?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "po_three_way_match"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "procurement_sla_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "three_way_match_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "goods_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "goods_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "goods_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gr_lines: {
        Row: {
          gr_id: string
          id: string
          item_id: string | null
          po_line_id: string | null
          quantity_received: number
          quantity_rejected: number
        }
        Insert: {
          gr_id: string
          id?: string
          item_id?: string | null
          po_line_id?: string | null
          quantity_received?: number
          quantity_rejected?: number
        }
        Update: {
          gr_id?: string
          id?: string
          item_id?: string | null
          po_line_id?: string | null
          quantity_received?: number
          quantity_rejected?: number
        }
        Relationships: [
          {
            foreignKeyName: "gr_lines_gr_id_fkey"
            columns: ["gr_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gr_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "gr_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gr_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "gr_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "gr_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "po_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_role_audit: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          performed_by: string
          reason: string | null
          role: string
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          performed_by: string
          reason?: string | null
          role: string
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          performed_by?: string
          reason?: string | null
          role?: string
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      inventory_count_lines: {
        Row: {
          count_id: string
          counted_qty: number
          created_at: string
          expected_qty: number
          id: string
          item_id: string
          notes: string | null
          unit_cost: number
          variance: number | null
          variance_value: number | null
        }
        Insert: {
          count_id: string
          counted_qty?: number
          created_at?: string
          expected_qty?: number
          id?: string
          item_id: string
          notes?: string | null
          unit_cost?: number
          variance?: number | null
          variance_value?: number | null
        }
        Update: {
          count_id?: string
          counted_qty?: number
          created_at?: string
          expected_qty?: number
          id?: string
          item_id?: string
          notes?: string | null
          unit_cost?: number
          variance?: number | null
          variance_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_variance_view"
            referencedColumns: ["count_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          count_date: string
          count_number: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          posted_at: string | null
          posted_by: string | null
          status: string
          tenant_id: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          count_date?: string
          count_number: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          count_date?: string
          count_number?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_period_closes: {
        Row: {
          closed_at: string
          closed_by: string | null
          created_at: string
          id: string
          items_count: number
          period: string
          snapshot: Json
          tenant_id: string
          total_qty: number
          total_value: number
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          created_at?: string
          id?: string
          items_count?: number
          period: string
          snapshot?: Json
          tenant_id: string
          total_qty?: number
          total_value?: number
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          created_at?: string
          id?: string
          items_count?: number
          period?: string
          snapshot?: Json
          tenant_id?: string
          total_qty?: number
          total_value?: number
        }
        Relationships: []
      }
      inventory_role_audit: {
        Row: {
          action: string
          comment: string | null
          created_at: string
          id: string
          performed_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          comment?: string | null
          created_at?: string
          id?: string
          performed_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          comment?: string | null
          created_at?: string
          id?: string
          performed_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      inventory_settings: {
        Row: {
          auto_je_on_movement: boolean
          cogs_account_code: string
          created_at: string
          low_stock_alerts_enabled: boolean
          negative_stock_allowed: boolean
          stock_account_code: string
          tenant_id: string
          updated_at: string
          valuation_method: string
          variance_account_code: string
        }
        Insert: {
          auto_je_on_movement?: boolean
          cogs_account_code?: string
          created_at?: string
          low_stock_alerts_enabled?: boolean
          negative_stock_allowed?: boolean
          stock_account_code?: string
          tenant_id: string
          updated_at?: string
          valuation_method?: string
          variance_account_code?: string
        }
        Update: {
          auto_je_on_movement?: boolean
          cogs_account_code?: string
          created_at?: string
          low_stock_alerts_enabled?: boolean
          negative_stock_allowed?: boolean
          stock_account_code?: string
          tenant_id?: string
          updated_at?: string
          valuation_method?: string
          variance_account_code?: string
        }
        Relationships: []
      }
      item_locations: {
        Row: {
          bin_location: string | null
          created_at: string
          id: string
          item_id: string
          quantity_on_hand: number
          tenant_id: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          bin_location?: string | null
          created_at?: string
          id?: string
          item_id: string
          quantity_on_hand?: number
          tenant_id: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          bin_location?: string | null
          created_at?: string
          id?: string
          item_id?: string
          quantity_on_hand?: number
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_locations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "item_locations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_locations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "item_locations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "item_locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          abc_class: string | null
          average_cost: number
          category: string | null
          code: string
          created_at: string
          default_warehouse_id: string | null
          id: string
          max_stock: number | null
          name: string
          quantity_on_hand: number
          reorder_level: number | null
          safety_stock: number
          selling_price: number
          status: string
          tenant_id: string
          unit: string
          unit_cost: number
          valuation_method: string
        }
        Insert: {
          abc_class?: string | null
          average_cost?: number
          category?: string | null
          code: string
          created_at?: string
          default_warehouse_id?: string | null
          id?: string
          max_stock?: number | null
          name: string
          quantity_on_hand?: number
          reorder_level?: number | null
          safety_stock?: number
          selling_price?: number
          status?: string
          tenant_id: string
          unit?: string
          unit_cost?: number
          valuation_method?: string
        }
        Update: {
          abc_class?: string | null
          average_cost?: number
          category?: string | null
          code?: string
          created_at?: string
          default_warehouse_id?: string | null
          id?: string
          max_stock?: number | null
          name?: string
          quantity_on_hand?: number
          reorder_level?: number | null
          safety_stock?: number
          selling_price?: number
          status?: string
          tenant_id?: string
          unit?: string
          unit_cost?: number
          valuation_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_default_warehouse_id_fkey"
            columns: ["default_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          posted_at: string | null
          posted_by: string | null
          source: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          entry_date?: string
          entry_number: string
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          source?: string
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          source?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          cost_center: string | null
          credit: number
          debit: number
          department: string | null
          description: string | null
          entry_id: string
          id: string
          project: string | null
        }
        Insert: {
          account_id: string
          cost_center?: string | null
          credit?: number
          debit?: number
          department?: string | null
          description?: string | null
          entry_id: string
          id?: string
          project?: string | null
        }
        Update: {
          account_id?: string
          cost_center?: string | null
          credit?: number
          debit?: number
          department?: string | null
          description?: string | null
          entry_id?: string
          id?: string
          project?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      licenses: {
        Row: {
          active_users: number | null
          created_at: string
          end_date: string
          id: string
          is_active: boolean
          license_type: string
          max_users: number | null
          module_name: string
          plan: string
          start_date: string
          tenant_id: string
        }
        Insert: {
          active_users?: number | null
          created_at?: string
          end_date: string
          id?: string
          is_active?: boolean
          license_type?: string
          max_users?: number | null
          module_name: string
          plan?: string
          start_date: string
          tenant_id: string
        }
        Update: {
          active_users?: number | null
          created_at?: string
          end_date?: string
          id?: string
          is_active?: boolean
          license_type?: string
          max_users?: number | null
          module_name?: string
          plan?: string
          start_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "licenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "licenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "licenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          include_resolved: boolean
          modules: string[]
          severities: string[]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          include_resolved?: boolean
          modules?: string[]
          severities?: string[]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          include_resolved?: boolean
          modules?: string[]
          severities?: string[]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          ap_invoice_id: string | null
          ar_invoice_id: string | null
          created_at: string
          created_by: string
          id: string
          journal_entry_id: string | null
          payment_date: string
          payment_method: string
          payment_type: string
          reference: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          ap_invoice_id?: string | null
          ar_invoice_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          journal_entry_id?: string | null
          payment_date?: string
          payment_method?: string
          payment_type: string
          reference?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          ap_invoice_id?: string | null
          ar_invoice_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          journal_entry_id?: string | null
          payment_date?: string
          payment_method?: string
          payment_type?: string
          reference?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_ap_invoice_id_fkey"
            columns: ["ap_invoice_id"]
            isOneToOne: false
            referencedRelation: "ap_aging_view"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payments_ap_invoice_id_fkey"
            columns: ["ap_invoice_id"]
            isOneToOne: false
            referencedRelation: "ap_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_ar_invoice_id_fkey"
            columns: ["ar_invoice_id"]
            isOneToOne: false
            referencedRelation: "ar_aging_view"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payments_ar_invoice_id_fkey"
            columns: ["ar_invoice_id"]
            isOneToOne: false
            referencedRelation: "ar_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_ar_invoice_id_fkey"
            columns: ["ar_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["ar_invoice_id"]
          },
          {
            foreignKeyName: "payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_lines: {
        Row: {
          created_at: string
          deductions: number
          employee_id: string
          gross: number
          id: string
          net: number
          run_id: string
          taxes: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          deductions?: number
          employee_id: string
          gross?: number
          id?: string
          net?: number
          run_id: string
          taxes?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          deductions?: number
          employee_id?: string
          gross?: number
          id?: string
          net?: number
          run_id?: string
          taxes?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          employee_count: number
          executed_at: string | null
          executed_by: string | null
          gross_total: number
          id: string
          net_total: number
          notes: string | null
          pay_date: string
          period: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          employee_count?: number
          executed_at?: string | null
          executed_by?: string | null
          gross_total?: number
          id?: string
          net_total?: number
          notes?: string | null
          pay_date: string
          period: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          employee_count?: number
          executed_at?: string | null
          executed_by?: string | null
          gross_total?: number
          id?: string
          net_total?: number
          notes?: string | null
          pay_date?: string
          period?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      period_locks: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          module: string
          period: string
          status: string
          tenant_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          module: string
          period: string
          status?: string
          tenant_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          module?: string
          period?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      po_lines: {
        Row: {
          description: string
          id: string
          item_id: string | null
          po_id: string
          quantity: number
          total: number | null
          unit_cost: number
        }
        Insert: {
          description: string
          id?: string
          item_id?: string | null
          po_id: string
          quantity?: number
          total?: number | null
          unit_cost?: number
        }
        Update: {
          description?: string
          id?: string
          item_id?: string | null
          po_id?: string
          quantity?: number
          total?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "po_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "po_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "po_three_way_match"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "procurement_sla_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "three_way_match_view"
            referencedColumns: ["po_id"]
          },
        ]
      }
      procurement_approval_thresholds: {
        Row: {
          approver: string
          created_at: string
          doc_type: string
          id: string
          level: string
          max_amount: number | null
          sla_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approver: string
          created_at?: string
          doc_type: string
          id?: string
          level: string
          max_amount?: number | null
          sla_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approver?: string
          created_at?: string
          doc_type?: string
          id?: string
          level?: string
          max_amount?: number | null
          sla_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_approval_thresholds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_approval_thresholds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_approval_thresholds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_approvals: {
        Row: {
          amount: number
          approver_role: string
          comment: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          doc_id: string
          doc_type: string
          id: string
          level_label: string
          level_order: number
          sla_due_at: string
          sla_hours: number
          status: string
          tenant_id: string
        }
        Insert: {
          amount?: number
          approver_role: string
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          doc_id: string
          doc_type: string
          id?: string
          level_label: string
          level_order: number
          sla_due_at?: string
          sla_hours?: number
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          approver_role?: string
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          doc_id?: string
          doc_type?: string
          id?: string
          level_label?: string
          level_order?: number
          sla_due_at?: string
          sla_hours?: number
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_match_decisions: {
        Row: {
          created_at: string
          decided_by: string | null
          decision: string
          id: string
          po_id: string
          reason: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          decided_by?: string | null
          decision: string
          id?: string
          po_id: string
          reason: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          decided_by?: string | null
          decision?: string
          id?: string
          po_id?: string
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_match_decisions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "po_three_way_match"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "procurement_match_decisions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "procurement_sla_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "procurement_match_decisions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_match_decisions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "three_way_match_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "procurement_match_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_match_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_match_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_role_audit: {
        Row: {
          action: string
          comment: string | null
          created_at: string
          id: string
          performed_by: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          comment?: string | null
          created_at?: string
          id?: string
          performed_by: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          comment?: string | null
          created_at?: string
          id?: string
          performed_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      procurement_settings: {
        Row: {
          created_at: string
          id: string
          require_gr_before_ap: boolean
          require_pr_before_po: boolean
          sla_color_critical: string
          sla_color_ok: string
          sla_color_warning: string
          sla_critical_pct: number
          sla_gr_to_ap_days: number
          sla_po_to_gr_days: number
          sla_pr_hours: number
          sla_pr_to_po_hours: number
          sla_warning_pct: number
          tenant_id: string
          three_way_tolerance_amount: number
          three_way_tolerance_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          require_gr_before_ap?: boolean
          require_pr_before_po?: boolean
          sla_color_critical?: string
          sla_color_ok?: string
          sla_color_warning?: string
          sla_critical_pct?: number
          sla_gr_to_ap_days?: number
          sla_po_to_gr_days?: number
          sla_pr_hours?: number
          sla_pr_to_po_hours?: number
          sla_warning_pct?: number
          tenant_id: string
          three_way_tolerance_amount?: number
          three_way_tolerance_pct?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          require_gr_before_ap?: boolean
          require_pr_before_po?: boolean
          sla_color_critical?: string
          sla_color_ok?: string
          sla_color_warning?: string
          sla_critical_pct?: number
          sla_gr_to_ap_days?: number
          sla_po_to_gr_days?: number
          sla_pr_hours?: number
          sla_pr_to_po_hours?: number
          sla_warning_pct?: number
          tenant_id?: string
          three_way_tolerance_amount?: number
          three_way_tolerance_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "procurement_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_costs: {
        Row: {
          amount: number
          category: string
          cost_date: string
          created_at: string
          created_by: string
          description: string | null
          gl_account_id: string | null
          id: string
          journal_entry_id: string | null
          project_id: string
        }
        Insert: {
          amount: number
          category: string
          cost_date?: string
          created_at?: string
          created_by: string
          description?: string | null
          gl_account_id?: string | null
          id?: string
          journal_entry_id?: string | null
          project_id: string
        }
        Update: {
          amount?: number
          category?: string
          cost_date?: string
          created_at?: string
          created_by?: string
          description?: string | null
          gl_account_id?: string | null
          id?: string
          journal_entry_id?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_costs_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_costs_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "project_costs_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "project_costs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "project_costs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_role_audit: {
        Row: {
          action: string
          created_at: string
          id: string
          performed_by: string
          reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          performed_by: string
          reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          performed_by?: string
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          budget: number
          client: string | null
          completion_pct: number
          created_at: string
          created_by: string
          department: string | null
          end_date: string | null
          id: string
          name: string
          project_code: string
          project_manager: string | null
          start_date: string | null
          status: string
          tenant_id: string
          total_costs: number
        }
        Insert: {
          budget?: number
          client?: string | null
          completion_pct?: number
          created_at?: string
          created_by: string
          department?: string | null
          end_date?: string | null
          id?: string
          name: string
          project_code: string
          project_manager?: string | null
          start_date?: string | null
          status?: string
          tenant_id: string
          total_costs?: number
        }
        Update: {
          budget?: number
          client?: string | null
          completion_pct?: number
          created_at?: string
          created_by?: string
          department?: string | null
          end_date?: string | null
          id?: string
          name?: string
          project_code?: string
          project_manager?: string | null
          start_date?: string | null
          status?: string
          tenant_id?: string
          total_costs?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string
          id: string
          order_date: string
          po_number: string
          status: string
          supplier_id: string
          tenant_id: string
          total: number
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          order_date?: string
          po_number?: string
          status?: string
          supplier_id: string
          tenant_id: string
          total?: number
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          order_date?: string
          po_number?: string
          status?: string
          supplier_id?: string
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requisitions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          description: string | null
          estimated_total: number
          id: string
          po_id: string | null
          pr_number: string
          request_date: string
          requested_by: string
          status: string
          tenant_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          description?: string | null
          estimated_total?: number
          id?: string
          po_id?: string | null
          pr_number?: string
          request_date?: string
          requested_by: string
          status?: string
          tenant_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          description?: string | null
          estimated_total?: number
          id?: string
          po_id?: string | null
          pr_number?: string
          request_date?: string
          requested_by?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requisitions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "po_three_way_match"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "purchase_requisitions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "procurement_sla_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "purchase_requisitions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requisitions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "three_way_match_view"
            referencedColumns: ["po_id"]
          },
          {
            foreignKeyName: "purchase_requisitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_requisitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_requisitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          id: string
          quote_date: string
          quote_number: string
          status: string
          tenant_id: string
          total: number
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          quote_date?: string
          quote_number?: string
          status?: string
          tenant_id: string
          total?: number
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          quote_date?: string
          quote_number?: string
          status?: string
          tenant_id?: string
          total?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "quotations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "quotations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_lines: {
        Row: {
          created_at: string
          description: string | null
          id: string
          item_id: string | null
          quantity: number
          quotation_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          item_id?: string | null
          quantity?: number
          quotation_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          item_id?: string | null
          quantity?: number
          quotation_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "quote_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "quote_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "quote_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["quote_id"]
          },
        ]
      }
      report_templates: {
        Row: {
          columns: Json
          created_at: string
          created_by: string | null
          data_source: string
          filters: Json
          group_by: string | null
          id: string
          module: string
          name: string
          permission: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          data_source: string
          filters?: Json
          group_by?: string | null
          id?: string
          module: string
          name: string
          permission?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          data_source?: string
          filters?: Json
          group_by?: string | null
          id?: string
          module?: string
          name?: string
          permission?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      requisition_lines: {
        Row: {
          description: string
          estimated_unit_cost: number
          id: string
          item_id: string | null
          quantity: number
          requisition_id: string
          total: number | null
        }
        Insert: {
          description: string
          estimated_unit_cost?: number
          id?: string
          item_id?: string | null
          quantity?: number
          requisition_id: string
          total?: number | null
        }
        Update: {
          description?: string
          estimated_unit_cost?: number
          id?: string
          item_id?: string | null
          quantity?: number
          requisition_id?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "requisition_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "requisition_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "requisition_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "requisition_lines_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "purchase_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_assessments: {
        Row: {
          assessment_date: string
          assessor: string
          created_at: string
          id: string
          impact: number
          likelihood: number
          notes: string | null
          risk_id: string
        }
        Insert: {
          assessment_date?: string
          assessor: string
          created_at?: string
          id?: string
          impact: number
          likelihood: number
          notes?: string | null
          risk_id: string
        }
        Update: {
          assessment_date?: string
          assessor?: string
          created_at?: string
          id?: string
          impact?: number
          likelihood?: number
          notes?: string | null
          risk_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_assessments_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "risk_register"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_register: {
        Row: {
          category: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          impact: number
          likelihood: number
          mitigation_plan: string | null
          owner: string | null
          residual_impact: number | null
          residual_likelihood: number | null
          review_date: string | null
          risk_code: string
          risk_score: number | null
          status: string
          tenant_id: string
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          impact?: number
          likelihood?: number
          mitigation_plan?: string | null
          owner?: string | null
          residual_impact?: number | null
          residual_likelihood?: number | null
          review_date?: string | null
          risk_code: string
          risk_score?: number | null
          status?: string
          tenant_id: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          impact?: number
          likelihood?: number
          mitigation_plan?: string | null
          owner?: string | null
          residual_impact?: number | null
          residual_likelihood?: number | null
          review_date?: string | null
          risk_code?: string
          risk_score?: number | null
          status?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "risk_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "risk_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_role_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      sales_orders: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          id: string
          order_date: string
          quotation_id: string | null
          so_number: string
          status: string
          tenant_id: string
          total: number
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          order_date?: string
          quotation_id?: string | null
          so_number?: string
          status?: string
          tenant_id: string
          total?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          order_date?: string
          quotation_id?: string | null
          so_number?: string
          status?: string
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_role_audit: {
        Row: {
          action: string
          comment: string | null
          created_at: string
          id: string
          performed_by: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          comment?: string | null
          created_at?: string
          id?: string
          performed_by: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          comment?: string | null
          created_at?: string
          id?: string
          performed_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      sales_settings: {
        Row: {
          auto_invoice_on_delivery: boolean
          color_critical: string
          color_ok: string
          color_warning: string
          reserve_stock_on_confirm: boolean
          sla_critical_pct: number
          sla_dn_to_invoice_days: number
          sla_quote_hours: number
          sla_quote_to_so_hours: number
          sla_so_to_dn_days: number
          sla_warning_pct: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_invoice_on_delivery?: boolean
          color_critical?: string
          color_ok?: string
          color_warning?: string
          reserve_stock_on_confirm?: boolean
          sla_critical_pct?: number
          sla_dn_to_invoice_days?: number
          sla_quote_hours?: number
          sla_quote_to_so_hours?: number
          sla_so_to_dn_days?: number
          sla_warning_pct?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_invoice_on_delivery?: boolean
          color_critical?: string
          color_ok?: string
          color_warning?: string
          reserve_stock_on_confirm?: boolean
          sla_critical_pct?: number
          sla_dn_to_invoice_days?: number
          sla_quote_hours?: number
          sla_quote_to_so_hours?: number
          sla_so_to_dn_days?: number
          sla_warning_pct?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      so_lines: {
        Row: {
          created_at: string
          description: string | null
          id: string
          item_id: string | null
          quantity: number
          quantity_delivered: number
          so_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          item_id?: string | null
          quantity?: number
          quantity_delivered?: number
          so_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          item_id?: string | null
          quantity?: number
          quantity_delivered?: number
          so_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "so_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "so_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "so_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "so_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "so_lines_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_cycle_view"
            referencedColumns: ["so_id"]
          },
          {
            foreignKeyName: "so_lines_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "so_lines_so_id_fkey"
            columns: ["so_id"]
            isOneToOne: false
            referencedRelation: "sales_sla_view"
            referencedColumns: ["so_id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          item_id: string
          journal_entry_id: string | null
          movement_date: string
          movement_type: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          status: string
          tenant_id: string
          total_value: number
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          journal_entry_id?: string | null
          movement_date?: string
          movement_type: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          tenant_id: string
          total_value?: number
          unit_cost?: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          journal_entry_id?: string | null
          movement_date?: string
          movement_type?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          tenant_id?: string
          total_value?: number
          unit_cost?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "stock_movements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_valuation_layers: {
        Row: {
          cost_in: number
          created_at: string
          id: string
          item_id: string
          layer_date: string
          qty_in: number
          qty_remaining: number
          source_id: string | null
          source_type: string | null
          tenant_id: string
          warehouse_id: string | null
        }
        Insert: {
          cost_in?: number
          created_at?: string
          id?: string
          item_id: string
          layer_date?: string
          qty_in?: number
          qty_remaining?: number
          source_id?: string | null
          source_type?: string | null
          tenant_id: string
          warehouse_id?: string | null
        }
        Update: {
          cost_in?: number
          created_at?: string
          id?: string
          item_id?: string
          layer_date?: string
          qty_in?: number
          qty_remaining?: number
          source_id?: string | null
          source_type?: string | null
          tenant_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_valuation_layers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_valuation_layers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_valuation_layers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_valuation_layers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_valuation_layers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          payment_terms: number | null
          phone: string | null
          status: string
          tax_id: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          payment_terms?: number | null
          phone?: string | null
          status?: string
          tax_id?: string | null
          tenant_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          payment_terms?: number | null
          phone?: string | null
          status?: string
          tax_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_modules: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          deactivated_at: string | null
          id: string
          license_id: string | null
          module_name: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          id?: string
          license_id?: string | null
          module_name: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          id?: string
          license_id?: string | null
          module_name?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_modules_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_modules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_modules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_modules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          currency: string
          fiscal_year_start: number
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          fiscal_year_start?: number
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          fiscal_year_start?: number
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      treasury_period_closes: {
        Row: {
          accounts_count: number
          attempt: number
          closed_at: string
          closed_by: string
          created_at: string
          error_message: string | null
          id: string
          period: string
          reconciliations_count: number
          snapshot: Json
          status: string
          tenant_id: string
          total_balance: number
        }
        Insert: {
          accounts_count?: number
          attempt?: number
          closed_at?: string
          closed_by: string
          created_at?: string
          error_message?: string | null
          id?: string
          period: string
          reconciliations_count?: number
          snapshot?: Json
          status?: string
          tenant_id: string
          total_balance?: number
        }
        Update: {
          accounts_count?: number
          attempt?: number
          closed_at?: string
          closed_by?: string
          created_at?: string
          error_message?: string | null
          id?: string
          period?: string
          reconciliations_count?: number
          snapshot?: Json
          status?: string
          tenant_id?: string
          total_balance?: number
        }
        Relationships: []
      }
      treasury_role_audit: {
        Row: {
          action: string
          actor_id: string
          comment: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id: string
          comment?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      treasury_settings: {
        Row: {
          auto_je_on_reconciliation: boolean
          low_cash_threshold: number
          match_amount_tolerance: number
          match_date_window_days: number
          pivot_currency: string
          tenant_id: string
          unreconciled_alert_days: number
          updated_at: string
        }
        Insert: {
          auto_je_on_reconciliation?: boolean
          low_cash_threshold?: number
          match_amount_tolerance?: number
          match_date_window_days?: number
          pivot_currency?: string
          tenant_id: string
          unreconciled_alert_days?: number
          updated_at?: string
        }
        Update: {
          auto_je_on_reconciliation?: boolean
          low_cash_threshold?: number
          match_amount_tolerance?: number
          match_date_window_days?: number
          pivot_currency?: string
          tenant_id?: string
          unreconciled_alert_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_role_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          role_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "erp_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_role_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_role_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_instances: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          decided_by: string | null
          id: string
          notes: string | null
          reference_id: string | null
          reference_type: string
          rule_id: string
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          decided_by?: string | null
          id?: string
          notes?: string | null
          reference_id?: string | null
          reference_type: string
          rule_id: string
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          decided_by?: string | null
          id?: string
          notes?: string | null
          reference_id?: string | null
          reference_type?: string
          rule_id?: string
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_instances_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "workflow_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "workflow_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "workflow_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_rules: {
        Row: {
          approvers: Json
          combinator: string
          conditions: Json
          created_at: string
          escalation: Json | null
          event_type: string
          id: string
          is_active: boolean
          module: string
          name: string
          sla_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approvers?: Json
          combinator?: string
          conditions?: Json
          created_at?: string
          escalation?: Json | null
          event_type: string
          id?: string
          is_active?: boolean
          module: string
          name: string
          sla_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approvers?: Json
          combinator?: string
          conditions?: Json
          created_at?: string
          escalation?: Json | null
          event_type?: string
          id?: string
          is_active?: boolean
          module?: string
          name?: string
          sla_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "workflow_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "workflow_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      abc_analysis_view: {
        Row: {
          abc_class: string | null
          item_id: string | null
          revenue_12m: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "dn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
        ]
      }
      ap_aging_view: {
        Row: {
          amount_paid: number | null
          approval_status: string | null
          bucket: string | null
          days_overdue: number | null
          due_date: string | null
          invoice_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          outstanding: number | null
          status: string | null
          supplier_id: string | null
          supplier_name: string | null
          tenant_id: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ap_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ap_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_aging_view: {
        Row: {
          amount_paid: number | null
          bucket: string | null
          customer_id: string | null
          customer_name: string | null
          days_overdue: number | null
          due_date: string | null
          invoice_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          outstanding: number | null
          status: string | null
          tenant_id: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ar_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ar_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ar_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_credit_exposure_view: {
        Row: {
          credit_limit: number | null
          customer_id: string | null
          customer_name: string | null
          dso: number | null
          outstanding: number | null
          overdue: number | null
          risk_score: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_kpis_view: {
        Row: {
          accumulated: number | null
          active_count: number | null
          depreciation_ytd: number | null
          disposed_count: number | null
          gross_value: number | null
          net_book_value: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets_register_view: {
        Row: {
          accumulated_depreciation: number | null
          acquisition_cost: number | null
          acquisition_date: string | null
          asset_code: string | null
          asset_id: string | null
          assigned_to: string | null
          category_name: string | null
          depreciation_method: string | null
          location: string | null
          name: string | null
          net_book_value: number | null
          salvage_value: number | null
          status: string | null
          tenant_id: string | null
          useful_life_months: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_ledger_detail: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          credit: number | null
          debit: number | null
          entry_date: string | null
          entry_description: string | null
          entry_id: string | null
          entry_number: string | null
          line_description: string | null
          line_id: string | null
          running_balance: number | null
          source: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_periods_view: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          draft_count: number | null
          period: string | null
          posted_count: number | null
          reversed_count: number | null
          status: string | null
          tenant_id: string | null
          total_credit: number | null
          total_debit: number | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_sig_view: {
        Row: {
          achats_consommes: number | null
          charges_personnel: number | null
          chiffre_affaires: number | null
          dotations: number | null
          ebe: number | null
          impots_taxes: number | null
          marge_commerciale: number | null
          period: string | null
          production_stockee: number | null
          resultat_exploitation: number | null
          resultat_net: number | null
          services_ext: number | null
          tenant_id: string | null
          valeur_ajoutee: number | null
          ventes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_trial_balance: {
        Row: {
          account_id: string | null
          account_type: string | null
          balance: number | null
          code: string | null
          name: string | null
          tenant_id: string | null
          total_credit: number | null
          total_debit: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "gl_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_abc_view: {
        Row: {
          abc_class: string | null
          category: string | null
          code: string | null
          cum_pct: number | null
          item_id: string | null
          name: string | null
          qty_12m: number | null
          revenue_12m: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_kpis_view: {
        Row: {
          active_items: number | null
          low_stock_items: number | null
          out_of_stock_items: number | null
          tenant_id: string | null
          total_stock_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_slow_moving_view: {
        Row: {
          category: string | null
          code: string | null
          item_id: string | null
          last_outbound_date: string | null
          movement_class: string | null
          name: string | null
          quantity_on_hand: number | null
          stock_value: number | null
          tenant_id: string | null
          unit_cost: number | null
        }
        Insert: {
          category?: string | null
          code?: string | null
          item_id?: string | null
          last_outbound_date?: never
          movement_class?: never
          name?: string | null
          quantity_on_hand?: number | null
          stock_value?: never
          tenant_id?: string | null
          unit_cost?: never
        }
        Update: {
          category?: string | null
          code?: string | null
          item_id?: string | null
          last_outbound_date?: never
          movement_class?: never
          name?: string | null
          quantity_on_hand?: number | null
          stock_value?: never
          tenant_id?: string | null
          unit_cost?: never
        }
        Relationships: [
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_turnover_view: {
        Row: {
          category: string | null
          cogs_12m: number | null
          days_on_hand: number | null
          inv_value: number | null
          tenant_id: string | null
          turnover_ratio: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_valuation_by_category_view: {
        Row: {
          avg_cost_value: number | null
          category: string | null
          fifo_value: number | null
          items_count: number | null
          tenant_id: string | null
          total_qty: number | null
          variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_variance_view: {
        Row: {
          count_date: string | null
          count_id: string | null
          count_number: string | null
          items_checked: number | null
          items_matched: number | null
          items_variance: number | null
          status: string | null
          tenant_id: string | null
          total_value_diff: number | null
          warehouse_code: string | null
          warehouse_name: string | null
        }
        Relationships: []
      }
      low_stock_alerts_view: {
        Row: {
          code: string | null
          gap: number | null
          item_id: string | null
          name: string | null
          quantity_on_hand: number | null
          tenant_id: string | null
          threshold: number | null
          unit: string | null
        }
        Insert: {
          code?: string | null
          gap?: never
          item_id?: string | null
          name?: string | null
          quantity_on_hand?: number | null
          tenant_id?: string | null
          threshold?: never
          unit?: string | null
        }
        Update: {
          code?: string | null
          gap?: never
          item_id?: string | null
          name?: string | null
          quantity_on_hand?: number | null
          tenant_id?: string | null
          threshold?: never
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_kpis_view: {
        Row: {
          active_employees: number | null
          approved_runs: number | null
          draft_runs: number | null
          fiscal_year: string | null
          gross_ytd: number | null
          net_ytd: number | null
          posted_runs: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      payroll_register_view: {
        Row: {
          deductions: number | null
          department: string | null
          first_name: string | null
          gross: number | null
          job_title: string | null
          last_name: string | null
          matricule: string | null
          net: number | null
          pay_date: string | null
          period: string | null
          status: string | null
          taxes: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      po_three_way_match: {
        Row: {
          ap_total_window: number | null
          gr_total: number | null
          match_status: string | null
          po_id: string | null
          po_number: string | null
          po_status: string | null
          po_total: number | null
          tenant_id: string | null
        }
        Insert: {
          ap_total_window?: never
          gr_total?: never
          match_status?: never
          po_id?: string | null
          po_number?: string | null
          po_status?: string | null
          po_total?: number | null
          tenant_id?: string | null
        }
        Update: {
          ap_total_window?: never
          gr_total?: never
          match_status?: never
          po_id?: string | null
          po_number?: string | null
          po_status?: string | null
          po_total?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_audit_view: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          amount: number | null
          comment: string | null
          doc_id: string | null
          doc_number: string | null
          doc_type: string | null
          event_at: string | null
          event_type: string | null
          id: string | null
          level_label: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      procurement_kpis_view: {
        Row: {
          gr_today: number | null
          po_pending: number | null
          po_value_mtd: number | null
          pr_open: number | null
          tenant_id: string | null
          tw_discrepancies: number | null
        }
        Insert: {
          gr_today?: never
          po_pending?: never
          po_value_mtd?: never
          pr_open?: never
          tenant_id?: string | null
          tw_discrepancies?: never
        }
        Update: {
          gr_today?: never
          po_pending?: never
          po_value_mtd?: never
          pr_open?: never
          tenant_id?: string | null
          tw_discrepancies?: never
        }
        Relationships: []
      }
      procurement_sla_view: {
        Row: {
          ap_date: string | null
          gr_date: string | null
          gr_to_ap_days: number | null
          po_date: string | null
          po_id: string | null
          po_number: string | null
          po_status: string | null
          po_to_gr_days: number | null
          pr_approved_at: string | null
          pr_cycle_hours: number | null
          pr_date: string | null
          pr_number: string | null
          pr_status: string | null
          pr_to_po_hours: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_audit_view: {
        Row: {
          action: string | null
          actor: string | null
          comment: string | null
          created_at: string | null
          detail: string | null
          event_type: string | null
          target: string | null
          tenant_id: string | null
        }
        Insert: {
          action?: string | null
          actor?: string | null
          comment?: string | null
          created_at?: string | null
          detail?: never
          event_type?: never
          target?: never
          tenant_id?: string | null
        }
        Update: {
          action?: string | null
          actor?: string | null
          comment?: string | null
          created_at?: string | null
          detail?: never
          event_type?: never
          target?: never
          tenant_id?: string | null
        }
        Relationships: []
      }
      sales_cycle_view: {
        Row: {
          ar_invoice_id: string | null
          customer_id: string | null
          customer_name: string | null
          invoice_number: string | null
          invoice_status: string | null
          invoice_total: number | null
          quote_id: string | null
          quote_number: string | null
          quote_status: string | null
          quote_total: number | null
          so_id: string | null
          so_number: string | null
          so_status: string | null
          so_total: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_kpis_view: {
        Row: {
          backlog: number | null
          open_quotes: number | null
          open_sos: number | null
          revenue_mtd: number | null
          tenant_id: string | null
        }
        Insert: {
          backlog?: never
          open_quotes?: never
          open_sos?: never
          revenue_mtd?: never
          tenant_id?: string | null
        }
        Update: {
          backlog?: never
          open_quotes?: never
          open_sos?: never
          revenue_mtd?: never
          tenant_id?: string | null
        }
        Relationships: []
      }
      sales_pipeline_view: {
        Row: {
          amount: number | null
          docs: number | null
          stage: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      sales_sla_view: {
        Row: {
          customer_id: string | null
          dn_to_invoice_days: number | null
          order_date: string | null
          quote_date: string | null
          quote_to_so_hours: number | null
          so_id: string | null
          so_number: string | null
          so_to_dn_days: number | null
          status: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_exposure_view"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_aging_view: {
        Row: {
          age_bucket: string | null
          items_count: number | null
          qty_remaining: number | null
          stock_value: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      stock_movements_audit_view: {
        Row: {
          created_at: string | null
          created_by: string | null
          entry_number: string | null
          id: string | null
          item_code: string | null
          item_id: string | null
          item_name: string | null
          journal_entry_id: string | null
          movement_date: string | null
          movement_type: string | null
          quantity: number | null
          reference_id: string | null
          reference_type: string | null
          status: string | null
          tenant_id: string | null
          total_value: number | null
          unit_cost: number | null
          warehouse_code: string | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_slow_moving_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "low_stock_alerts_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_valuation_view"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_movements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_ledger_detail"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "stock_movements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_valuation_view: {
        Row: {
          average_cost: number | null
          code: string | null
          item_id: string | null
          name: string | null
          quantity_on_hand: number | null
          stock_value: number | null
          tenant_id: string | null
          unit: string | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      three_way_match_view: {
        Row: {
          ap_invoice_count: number | null
          ap_value: number | null
          gr_qty: number | null
          gr_value: number | null
          gr_vs_ap_diff: number | null
          match_status: string | null
          order_date: string | null
          po_id: string | null
          po_number: string | null
          po_status: string | null
          po_total: number | null
          po_vs_gr_diff: number | null
          supplier_name: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_13w_forecast_view: {
        Row: {
          inflow_ar: number | null
          inflow_manual: number | null
          net_flow: number | null
          outflow_ap: number | null
          outflow_manual: number | null
          tenant_id: string | null
          week_index: number | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_cash_position_view: {
        Row: {
          bank_account_id: string | null
          bank_name: string | null
          currency: string | null
          current_balance: number | null
          last_reconciled_at: string | null
          name: string | null
          net_30d: number | null
          net_7d: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_close_history_view: {
        Row: {
          accounts_count: number | null
          attempt: number | null
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          created_at: string | null
          error_message: string | null
          id: string | null
          period: string | null
          reconciliations_count: number | null
          status: string | null
          tenant_id: string | null
          total_balance: number | null
        }
        Relationships: []
      }
      treasury_reconciliation_status_view: {
        Row: {
          bank_account_id: string | null
          last_reconciled_at: string | null
          name: string | null
          oldest_unreconciled_days: number | null
          reconciled_pct: number | null
          tenant_id: string | null
          total_count: number | null
          unreconciled_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_kpis_view"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_payroll_run: { Args: { _run_id: string }; Returns: undefined }
      approve_procurement_step: {
        Args: { _approval_id: string; _comment?: string }
        Returns: undefined
      }
      assign_budget_role: {
        Args: {
          p_action: string
          p_comment?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user: string
        }
        Returns: undefined
      }
      assign_compliance_role: {
        Args: {
          _action: string
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: undefined
      }
      assign_crm_role: {
        Args: {
          p_action: string
          p_reason?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user: string
          p_tenant?: string
        }
        Returns: undefined
      }
      assign_expense_role: {
        Args: {
          _action: string
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: Json
      }
      assign_fixed_asset_role: {
        Args: {
          p_action: string
          p_comment?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user: string
        }
        Returns: undefined
      }
      assign_hr_role: {
        Args: {
          p_action: string
          p_reason?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user: string
        }
        Returns: undefined
      }
      assign_inventory_role: {
        Args: {
          _action: string
          _comment?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: undefined
      }
      assign_procurement_role: {
        Args: {
          _action: string
          _comment?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: undefined
      }
      assign_project_role: {
        Args: {
          _action: string
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
          _tenant_id: string
        }
        Returns: Json
      }
      assign_risk_role: {
        Args: {
          _action: string
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: undefined
      }
      assign_sales_role: {
        Args: {
          _action: string
          _comment?: string
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: undefined
      }
      assign_treasury_role: {
        Args: {
          p_action: string
          p_comment?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user: string
        }
        Returns: undefined
      }
      close_gl_period: { Args: { _period: string }; Returns: string }
      close_inventory_period: {
        Args: { _period: string }
        Returns: {
          closed_at: string
          closed_by: string | null
          created_at: string
          id: string
          items_count: number
          period: string
          snapshot: Json
          tenant_id: string
          total_qty: number
          total_value: number
        }
        SetofOptions: {
          from: "*"
          to: "inventory_period_closes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_treasury_period: {
        Args: { _period: string }
        Returns: {
          accounts_count: number
          attempt: number
          closed_at: string
          closed_by: string
          created_at: string
          error_message: string | null
          id: string
          period: string
          reconciliations_count: number
          snapshot: Json
          status: string
          tenant_id: string
          total_balance: number
        }
        SetofOptions: {
          from: "*"
          to: "treasury_period_closes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_payroll_line: {
        Args: { _employee_id: string }
        Returns: {
          deductions: number
          gross: number
          net: number
          taxes: number
        }[]
      }
      confirm_quote_to_so: { Args: { _quote_id: string }; Returns: string }
      confirm_so: { Args: { _so_id: string }; Returns: undefined }
      convert_opportunity_to_quote: {
        Args: { _customer_id?: string; _opp_id: string; _valid_until?: string }
        Returns: string
      }
      convert_pr_to_po: {
        Args: { _pr_id: string; _supplier_id: string }
        Returns: string
      }
      convert_quote_to_so: { Args: { _quote_id: string }; Returns: string }
      create_tenant_for_user: {
        Args: { _tenant_name: string }
        Returns: string
      }
      generate_payroll_lines: { Args: { _run_id: string }; Returns: number }
      get_accessible_tenants: {
        Args: never
        Returns: {
          currency: string
          id: string
          name: string
        }[]
      }
      get_consolidated_cfo_kpis: {
        Args: { _tenant_ids: string[] }
        Returns: {
          ap_outstanding: number
          ap_overdue: number
          ap_overdue_count: number
          ar_outstanding: number
          ar_overdue: number
          ar_overdue_count: number
          cash_on_hand: number
          currency: string
          open_projects: number
          open_risks_high: number
          tenant_id: string
          tenant_name: string
          unmatched_recon_count: number
        }[]
      }
      get_consolidated_cfo_trends: {
        Args: { _months?: number; _tenant_ids: string[] }
        Returns: {
          cash_balance: number
          expenses: number
          month: string
          net_profit: number
          revenue: number
        }[]
      }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      has_crm_perm: {
        Args: { _action: string; _user_id: string }
        Returns: boolean
      }
      has_hr_perm: {
        Args: { _action: string; _user_id: string }
        Returns: boolean
      }
      has_inventory_perm: {
        Args: { _action: string; _user_id: string }
        Returns: boolean
      }
      has_procurement_perm: {
        Args: { _action: string; _level?: number; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_sales_perm: {
        Args: { _action: string; _user_id: string }
        Returns: boolean
      }
      has_treasury_perm: {
        Args: { _action: string; _user_id: string }
        Returns: boolean
      }
      invoice_from_delivery: { Args: { _dn_id: string }; Returns: string }
      join_tenant: { Args: { _tenant_name: string }; Returns: string }
      log_crm_export: {
        Args: {
          _format: string
          _kind: string
          _opportunity_id: string
          _record_id?: string
        }
        Returns: undefined
      }
      mark_all_erp_alerts_read: { Args: never; Returns: number }
      notify_inventory: {
        Args: {
          _message: string
          _ref: string
          _severity: string
          _tenant_id: string
          _title: string
        }
        Returns: undefined
      }
      notify_procurement: {
        Args: {
          _message: string
          _ref: string
          _severity: string
          _tenant_id: string
          _title: string
        }
        Returns: undefined
      }
      notify_sales: {
        Args: {
          _message: string
          _ref: string
          _severity: string
          _tenant_id: string
          _title: string
        }
        Returns: undefined
      }
      post_asset_disposal: {
        Args: {
          _asset_id: string
          _disposal_date: string
          _disposal_type: string
          _notes?: string
          _sale_price: number
        }
        Returns: string
      }
      post_delivery: { Args: { _lines: Json; _so_id: string }; Returns: string }
      post_inventory_count: { Args: { _count_id: string }; Returns: undefined }
      post_monthly_depreciation: {
        Args: { _period: string; _tenant_id: string }
        Returns: {
          amount: number
          asset_id: string
          journal_entry_id: string
        }[]
      }
      post_payroll_run: { Args: { _run_id: string }; Returns: string }
      record_match_decision: {
        Args: { _decision: string; _po_id: string; _reason: string }
        Returns: string
      }
      reject_procurement_step: {
        Args: { _approval_id: string; _comment: string }
        Returns: undefined
      }
      reopen_gl_period: { Args: { _period: string }; Returns: undefined }
      resolve_all_erp_alerts: {
        Args: { _module?: string; _severity?: string }
        Returns: number
      }
      resolve_erp_alert: { Args: { _alert_id: string }; Returns: boolean }
      reverse_journal_entry: {
        Args: { _entry_id: string; _reason?: string; _reverse_date?: string }
        Returns: string
      }
      seed_ap_defaults: { Args: { _tenant_id: string }; Returns: undefined }
      suggest_bank_matches: {
        Args: { p_line_id: string }
        Returns: {
          amount: number
          description: string
          score: number
          transaction_date: string
          transaction_id: string
        }[]
      }
      transfer_stock: {
        Args: {
          _from_wh: string
          _item_id: string
          _notes?: string
          _qty: number
          _to_wh: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "accountant"
        | "viewer"
        | "procurement_l1"
        | "procurement_l2"
        | "procurement_l3"
        | "procurement_controller"
        | "procurement_3wm_approver"
        | "sales_rep"
        | "sales_manager"
        | "sales_controller"
        | "inventory_clerk"
        | "inventory_manager"
        | "inventory_controller"
        | "treasury_clerk"
        | "treasury_manager"
        | "treasury_controller"
        | "cash_admin"
        | "asset_clerk"
        | "asset_accountant"
        | "asset_controller"
        | "asset_admin"
        | "budget_planner"
        | "budget_approver"
        | "budget_controller"
        | "budget_admin"
        | "project_planner"
        | "project_accountant"
        | "project_controller"
        | "project_admin"
        | "expense_clerk"
        | "expense_approver"
        | "expense_controller"
        | "expense_admin"
        | "compliance_officer"
        | "compliance_auditor"
        | "compliance_admin"
        | "risk_owner"
        | "risk_assessor"
        | "risk_admin"
        | "hr_clerk"
        | "hr_approver"
        | "payroll_officer"
        | "hr_auditor"
        | "hr_admin"
        | "crm_agent"
        | "crm_manager"
        | "crm_admin"
        | "crm_auditor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "admin",
        "manager",
        "accountant",
        "viewer",
        "procurement_l1",
        "procurement_l2",
        "procurement_l3",
        "procurement_controller",
        "procurement_3wm_approver",
        "sales_rep",
        "sales_manager",
        "sales_controller",
        "inventory_clerk",
        "inventory_manager",
        "inventory_controller",
        "treasury_clerk",
        "treasury_manager",
        "treasury_controller",
        "cash_admin",
        "asset_clerk",
        "asset_accountant",
        "asset_controller",
        "asset_admin",
        "budget_planner",
        "budget_approver",
        "budget_controller",
        "budget_admin",
        "project_planner",
        "project_accountant",
        "project_controller",
        "project_admin",
        "expense_clerk",
        "expense_approver",
        "expense_controller",
        "expense_admin",
        "compliance_officer",
        "compliance_auditor",
        "compliance_admin",
        "risk_owner",
        "risk_assessor",
        "risk_admin",
        "hr_clerk",
        "hr_approver",
        "payroll_officer",
        "hr_auditor",
        "hr_admin",
        "crm_agent",
        "crm_manager",
        "crm_admin",
        "crm_auditor",
      ],
    },
  },
} as const
