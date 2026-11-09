import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { queryClient } from "@/lib/query-client";
import Login from "./pages/Login";

// Chargement par route : chaque page devient son propre chunk. Avant ce
// découpage, les 111 pages étaient importées en eager et le bundle initial
// pesait 3 145 kB (791 kB gzip) — mesuré le 9 novembre 2026.
// `Login` reste en eager : c'est le premier écran d'un utilisateur non connecté,
// le charger dynamiquement ajouterait un aller-retour inutile.
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Index = lazy(() => import("./pages/Index"));
const JournalEntries = lazy(() => import("./pages/JournalEntries"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Treasury = lazy(() => import("./pages/Treasury"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Customers = lazy(() => import("./pages/Customers"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const AccountsReceivable = lazy(() => import("./pages/AccountsReceivable"));
const ARTransactions = lazy(() => import("./pages/ARTransactions"));
const ARAgingAnalysis = lazy(() => import("./pages/ARAgingAnalysis"));
const AccountsPayable = lazy(() => import("./pages/AccountsPayable"));
const APTransactions = lazy(() => import("./pages/APTransactions"));
const APPaymentPlanning = lazy(() => import("./pages/APPaymentPlanning"));
const ARReporting = lazy(() => import("./pages/ARReporting"));
const ARControl = lazy(() => import("./pages/ARControl"));
const ARSettings = lazy(() => import("./pages/ARSettings"));
const APReporting = lazy(() => import("./pages/APReporting"));
const APControl = lazy(() => import("./pages/APControl"));
const APSettings = lazy(() => import("./pages/APSettings"));
const GLTransactions = lazy(() => import("./pages/GLTransactions"));
const GLMasterData = lazy(() => import("./pages/GLMasterData"));
const GLReporting = lazy(() => import("./pages/GLReporting"));
const GLControl = lazy(() => import("./pages/GLControl"));
const GLSettings = lazy(() => import("./pages/GLSettings"));
const TreasuryTransactions = lazy(() => import("./pages/TreasuryTransactions"));
const TreasuryMasterData = lazy(() => import("./pages/TreasuryMasterData"));
const TreasuryReporting = lazy(() => import("./pages/TreasuryReporting"));
const TreasuryControl = lazy(() => import("./pages/TreasuryControl"));
const TreasurySettings = lazy(() => import("./pages/TreasurySettings"));
const FixedAssets = lazy(() => import("./pages/FixedAssets"));
const AssetsTransactions = lazy(() => import("./pages/AssetsTransactions"));
const AssetsMasterData = lazy(() => import("./pages/AssetsMasterData"));
const AssetsReporting = lazy(() => import("./pages/AssetsReporting"));
const AssetsControl = lazy(() => import("./pages/AssetsControl"));
const AssetsSettings = lazy(() => import("./pages/AssetsSettings"));
const Documentation = lazy(() => import("./pages/Documentation"));
const ModuleManagement = lazy(() => import("./pages/ModuleManagement"));
const BudgetForecast = lazy(() => import("./pages/BudgetForecast"));
const BudgetTransactions = lazy(() => import("./pages/BudgetTransactions"));
const BudgetMasterData = lazy(() => import("./pages/BudgetMasterData"));
const BudgetReporting = lazy(() => import("./pages/BudgetReporting"));
const BudgetControl = lazy(() => import("./pages/BudgetControl"));
const BudgetSettings = lazy(() => import("./pages/BudgetSettings"));
const ComplianceModule = lazy(() => import("./pages/ComplianceModule"));
const ComplianceTransactions = lazy(() => import("./pages/ComplianceTransactions"));
const ComplianceMasterData = lazy(() => import("./pages/ComplianceMasterData"));
const ComplianceReporting = lazy(() => import("./pages/ComplianceReporting"));
const ComplianceControl = lazy(() => import("./pages/ComplianceControl"));
const ComplianceSettings = lazy(() => import("./pages/ComplianceSettings"));
const ProjectAccounting = lazy(() => import("./pages/ProjectAccounting"));
const ProjectTransactions = lazy(() => import("./pages/ProjectTransactions"));
const ProjectMasterData = lazy(() => import("./pages/ProjectMasterData"));
const ProjectReporting = lazy(() => import("./pages/ProjectReporting"));
const ProjectControl = lazy(() => import("./pages/ProjectControl"));
const ProjectSettings = lazy(() => import("./pages/ProjectSettings"));
const AuditProjects = lazy(() => import("./pages/AuditProjects"));
const RiskManagement = lazy(() => import("./pages/RiskManagement"));
const RiskTransactions = lazy(() => import("./pages/RiskTransactions"));
const RiskMasterData = lazy(() => import("./pages/RiskMasterData"));
const RiskReporting = lazy(() => import("./pages/RiskReporting"));
const RiskControl = lazy(() => import("./pages/RiskControl"));
const RiskSettings = lazy(() => import("./pages/RiskSettings"));
const Procurement = lazy(() => import("./pages/Procurement"));
const ProcurementTransactions = lazy(() => import("./pages/ProcurementTransactions"));
const ProcurementMasterData = lazy(() => import("./pages/ProcurementMasterData"));
const ProcurementReporting = lazy(() => import("./pages/ProcurementReporting"));
const ProcurementControl = lazy(() => import("./pages/ProcurementControl"));
const ProcurementSettings = lazy(() => import("./pages/ProcurementSettings"));
const Inventory = lazy(() => import("./pages/Inventory"));
const InventoryTransactions = lazy(() => import("./pages/InventoryTransactions"));
const InventoryMasterData = lazy(() => import("./pages/InventoryMasterData"));
const InventoryReporting = lazy(() => import("./pages/InventoryReporting"));
const InventoryControl = lazy(() => import("./pages/InventoryControl"));
const InventorySettings = lazy(() => import("./pages/InventorySettings"));
const Sales = lazy(() => import("./pages/Sales"));
const SalesTransactions = lazy(() => import("./pages/SalesTransactions"));
const SalesMasterData = lazy(() => import("./pages/SalesMasterData"));
const SalesReporting = lazy(() => import("./pages/SalesReporting"));
const SalesControl = lazy(() => import("./pages/SalesControl"));
const SalesSettings = lazy(() => import("./pages/SalesSettings"));
const Expenses = lazy(() => import("./pages/Expenses"));
const ExpenseTransactions = lazy(() => import("./pages/ExpenseTransactions"));
const ExpenseMasterData = lazy(() => import("./pages/ExpenseMasterData"));
const ExpenseReporting = lazy(() => import("./pages/ExpenseReporting"));
const ExpenseControl = lazy(() => import("./pages/ExpenseControl"));
const ExpenseSettings = lazy(() => import("./pages/ExpenseSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const DataImport = lazy(() => import("./pages/DataImport"));
const AiHistory = lazy(() => import("./pages/AiHistory"));
const Employees = lazy(() => import("./pages/Employees"));
const PayrollRuns = lazy(() => import("./pages/PayrollRuns"));
const AuditHr = lazy(() => import("./pages/AuditHr"));
const HrSettings = lazy(() => import("./pages/HrSettings"));
const HrDashboard = lazy(() => import("./pages/HrDashboard"));
const HrTransactions = lazy(() => import("./pages/HrTransactions"));
const HrReporting = lazy(() => import("./pages/HrReporting"));
const HrControl = lazy(() => import("./pages/HrControl"));
const CrmDashboard = lazy(() => import("./pages/CrmDashboard"));
const CrmContacts = lazy(() => import("./pages/CrmContacts"));
const CrmOpportunities = lazy(() => import("./pages/CrmOpportunities"));
const CrmReporting = lazy(() => import("./pages/CrmReporting"));
const CrmControl = lazy(() => import("./pages/CrmControl"));
const CrmSettings = lazy(() => import("./pages/CrmSettings"));
const CrmReminders = lazy(() => import("./pages/CrmReminders"));
const CfoCockpit = lazy(() => import("./pages/CfoCockpit"));
const CfoConsolidated = lazy(() => import("./pages/CfoConsolidated"));
const Alerts = lazy(() => import("./pages/Alerts"));

const P = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

const PageFallback = () => (
  <div
    className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"
    role="status"
    aria-live="polite"
  >
    Chargement…
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/onboarding" element={<P><Onboarding /></P>} />
              {/* Protected routes */}
              <Route path="/" element={<P><Index /></P>} />
              {/* AR */}
              <Route path="/receivables" element={<P><AccountsReceivable /></P>} />
              <Route path="/receivables/transactions" element={<P><ARTransactions /></P>} />
              <Route path="/receivables/aging" element={<P><ARAgingAnalysis /></P>} />
              <Route path="/receivables/reporting" element={<P><ARReporting /></P>} />
              <Route path="/receivables/control" element={<P><ARControl /></P>} />
              <Route path="/receivables/settings" element={<P><ARSettings /></P>} />
              <Route path="/customers" element={<P><Customers /></P>} />
              {/* AP */}
              <Route path="/payables" element={<P><AccountsPayable /></P>} />
              <Route path="/payables/transactions" element={<P><APTransactions /></P>} />
              <Route path="/payables/payment-planning" element={<P><APPaymentPlanning /></P>} />
              <Route path="/payables/reporting" element={<P><APReporting /></P>} />
              <Route path="/payables/control" element={<P><APControl /></P>} />
              <Route path="/payables/settings" element={<P><APSettings /></P>} />
              <Route path="/suppliers" element={<P><Suppliers /></P>} />
              {/* GL */}
              <Route path="/journal" element={<P><JournalEntries /></P>} />
              <Route path="/journal/transactions" element={<P><GLTransactions /></P>} />
              <Route path="/journal/master-data" element={<P><GLMasterData /></P>} />
              <Route path="/journal/reporting" element={<P><GLReporting /></P>} />
              <Route path="/journal/control" element={<P><GLControl /></P>} />
              <Route path="/journal/settings" element={<P><GLSettings /></P>} />
              {/* Treasury */}
              <Route path="/treasury" element={<P><Treasury /></P>} />
              <Route path="/treasury/transactions" element={<P><TreasuryTransactions /></P>} />
              <Route path="/treasury/master-data" element={<P><TreasuryMasterData /></P>} />
              <Route path="/treasury/reporting" element={<P><TreasuryReporting /></P>} />
              <Route path="/treasury/control" element={<P><TreasuryControl /></P>} />
              <Route path="/treasury/settings" element={<P><TreasurySettings /></P>} />
              {/* Fixed Assets */}
              <Route path="/assets" element={<P><FixedAssets /></P>} />
              <Route path="/assets/transactions" element={<P><AssetsTransactions /></P>} />
              <Route path="/assets/master-data" element={<P><AssetsMasterData /></P>} />
              <Route path="/assets/reporting" element={<P><AssetsReporting /></P>} />
              <Route path="/assets/control" element={<P><AssetsControl /></P>} />
              <Route path="/assets/settings" element={<P><AssetsSettings /></P>} />
              {/* Budget & Forecast */}
              <Route path="/budget" element={<P><BudgetForecast /></P>} />
              <Route path="/budget/transactions" element={<P><BudgetTransactions /></P>} />
              <Route path="/budget/master-data" element={<P><BudgetMasterData /></P>} />
              <Route path="/budget/reporting" element={<P><BudgetReporting /></P>} />
              <Route path="/budget/control" element={<P><BudgetControl /></P>} />
              <Route path="/budget/settings" element={<P><BudgetSettings /></P>} />
              {/* Project Accounting */}
              <Route path="/projects" element={<P><ProjectAccounting /></P>} />
              <Route path="/projects/transactions" element={<P><ProjectTransactions /></P>} />
              <Route path="/projects/master-data" element={<P><ProjectMasterData /></P>} />
              <Route path="/projects/reporting" element={<P><ProjectReporting /></P>} />
              <Route path="/projects/control" element={<P><ProjectControl /></P>} />
              <Route path="/projects/settings" element={<P><ProjectSettings /></P>} />
              <Route path="/audit/projects" element={<P><AuditProjects /></P>} />

              {/* Procurement */}
              <Route path="/procurement" element={<P><Procurement /></P>} />
              <Route path="/procurement/transactions" element={<P><ProcurementTransactions /></P>} />
              <Route path="/procurement/master-data" element={<P><ProcurementMasterData /></P>} />
              <Route path="/procurement/reporting" element={<P><ProcurementReporting /></P>} />
              <Route path="/procurement/control" element={<P><ProcurementControl /></P>} />
              <Route path="/procurement/settings" element={<P><ProcurementSettings /></P>} />
              {/* Compliance */}
              <Route path="/compliance" element={<P><ComplianceModule /></P>} />
              <Route path="/compliance/transactions" element={<P><ComplianceTransactions /></P>} />
              <Route path="/compliance/master-data" element={<P><ComplianceMasterData /></P>} />
              <Route path="/compliance/reporting" element={<P><ComplianceReporting /></P>} />
              <Route path="/compliance/control" element={<P><ComplianceControl /></P>} />
              <Route path="/compliance/settings" element={<P><ComplianceSettings /></P>} />
              {/* Risk Management */}
              <Route path="/risk" element={<P><RiskManagement /></P>} />
              <Route path="/risk/transactions" element={<P><RiskTransactions /></P>} />
              <Route path="/risk/master-data" element={<P><RiskMasterData /></P>} />
              <Route path="/risk/reporting" element={<P><RiskReporting /></P>} />
              <Route path="/risk/control" element={<P><RiskControl /></P>} />
              <Route path="/risk/settings" element={<P><RiskSettings /></P>} />
              {/* Inventory */}
              <Route path="/inventory" element={<P><Inventory /></P>} />
              <Route path="/inventory/transactions" element={<P><InventoryTransactions /></P>} />
              <Route path="/inventory/master-data" element={<P><InventoryMasterData /></P>} />
              <Route path="/inventory/reporting" element={<P><InventoryReporting /></P>} />
              <Route path="/inventory/control" element={<P><InventoryControl /></P>} />
              <Route path="/inventory/settings" element={<P><InventorySettings /></P>} />
              {/* Sales */}
              <Route path="/sales" element={<P><Sales /></P>} />
              <Route path="/sales/transactions" element={<P><SalesTransactions /></P>} />
              <Route path="/sales/master-data" element={<P><SalesMasterData /></P>} />
              <Route path="/sales/reporting" element={<P><SalesReporting /></P>} />
              <Route path="/sales/control" element={<P><SalesControl /></P>} />
              <Route path="/sales/settings" element={<P><SalesSettings /></P>} />
              {/* Expenses */}
              <Route path="/expenses" element={<P><Expenses /></P>} />
              <Route path="/expenses/transactions" element={<P><ExpenseTransactions /></P>} />
              <Route path="/expenses/master-data" element={<P><ExpenseMasterData /></P>} />
              <Route path="/expenses/reporting" element={<P><ExpenseReporting /></P>} />
              <Route path="/expenses/control" element={<P><ExpenseControl /></P>} />
              <Route path="/expenses/settings" element={<P><ExpenseSettings /></P>} />
              <Route path="/admin/modules" element={<P><ModuleManagement /></P>} />
              <Route path="/admin/import" element={<P><DataImport /></P>} />
              <Route path="/ai/history" element={<P><AiHistory /></P>} />
              {/* HR / Payroll */}
              <Route path="/hr" element={<P><HrDashboard /></P>} />
              <Route path="/hr/transactions" element={<P><HrTransactions /></P>} />
              <Route path="/hr/employees" element={<P><Employees /></P>} />
              <Route path="/hr/payroll" element={<P><PayrollRuns /></P>} />
              <Route path="/hr/reporting" element={<P><HrReporting /></P>} />
              <Route path="/hr/control" element={<P><HrControl /></P>} />
              <Route path="/payroll" element={<P><PayrollRuns /></P>} />
              <Route path="/audit/hr" element={<P><AuditHr /></P>} />
              <Route path="/hr/settings" element={<P><HrSettings /></P>} />
              {/* CRM */}
              <Route path="/crm" element={<P><CrmDashboard /></P>} />
              <Route path="/crm/contacts" element={<P><CrmContacts /></P>} />
              <Route path="/crm/opportunities" element={<P><CrmOpportunities /></P>} />
              <Route path="/crm/reminders" element={<P><CrmReminders /></P>} />
              <Route path="/crm/reporting" element={<P><CrmReporting /></P>} />
              <Route path="/crm/control" element={<P><CrmControl /></P>} />
              <Route path="/crm/settings" element={<P><CrmSettings /></P>} />
              {/* Global */}
              <Route path="/cockpit" element={<P><CfoCockpit /></P>} />
              <Route path="/cockpit/consolidated" element={<P><CfoConsolidated /></P>} />
              <Route path="/alerts" element={<P><Alerts /></P>} />
              <Route path="/invoices" element={<P><Invoices /></P>} />
              <Route path="/reports" element={<P><Reports /></P>} />
              <Route path="/settings" element={<P><Settings /></P>} />
              <Route path="/docs" element={<P><Documentation /></P>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;