import { useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const gridStroke = "hsl(220, 14%, 88%)";
const axisStroke = "hsl(220, 10%, 46%)";
const fmt = (n: number) => n.toLocaleString("fr-FR");

export function RevenueChart() {
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["monthly-payment-trends"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("amount, payment_date, payment_type")
        .order("payment_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const monthlyData = useMemo(() => {
    const months: Record<string, { month: string; arReceipts: number; apPayments: number }> = {};
    const now = new Date();

    // Initialize last 12 months
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("fr-FR", { month: "short" });
      months[key] = { month: label, arReceipts: 0, apPayments: 0 };
    }

    for (const p of payments) {
      const key = p.payment_date.slice(0, 7);
      if (months[key]) {
        if (p.payment_type === "ar_receipt") months[key].arReceipts += Number(p.amount);
        else if (p.payment_type === "ap_payment") months[key].apPayments += Number(p.amount);
      }
    }

    return Object.values(months);
  }, [payments]);

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-card-foreground mb-4">Encaissements & Décaissements — 12 mois</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={axisStroke} />
            <YAxis tick={{ fontSize: 11 }} stroke={axisStroke} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
            <Tooltip
              formatter={(value: number, name: string) => [`${fmt(value)} XOF`, name === "arReceipts" ? "Encaissements" : "Décaissements"]}
              contentStyle={{ borderRadius: "0.375rem", border: `1px solid ${gridStroke}`, fontSize: "12px" }}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} formatter={(v) => v === "arReceipts" ? "Encaissements AR" : "Décaissements AP"} />
            <Line type="monotone" dataKey="arReceipts" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="apPayments" stroke="hsl(220, 50%, 22%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-card-foreground mb-4">Comparaison mensuelle</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={axisStroke} />
            <YAxis tick={{ fontSize: 11 }} stroke={axisStroke} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
            <Tooltip
              formatter={(value: number, name: string) => [`${fmt(value)} XOF`, name === "arReceipts" ? "Encaissements" : "Décaissements"]}
              contentStyle={{ borderRadius: "0.375rem", border: `1px solid ${gridStroke}`, fontSize: "12px" }}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} formatter={(v) => v === "arReceipts" ? "Encaissements AR" : "Décaissements AP"} />
            <Bar dataKey="arReceipts" fill="hsl(142, 71%, 45%)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="apPayments" fill="hsl(220, 50%, 22%)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
