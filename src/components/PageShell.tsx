import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { ReactNode } from "react";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full min-w-0">
        <DashboardSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopNav />
          <main className="min-w-0 max-w-full flex-1 space-y-5 overflow-auto p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
