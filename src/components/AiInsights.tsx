import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
} from "lucide-react";

const predictions = [
  { month: "Mar", predicted: 92000, confidence: 87 },
  { month: "Apr", predicted: 98000, confidence: 82 },
  { month: "May", predicted: 105000, confidence: 76 },
];

const categorizations = [
  { description: "Office Depot - Supplies", suggestion: "Office Supplies", confidence: 95 },
  { description: "AWS Monthly", suggestion: "Cloud Services", confidence: 92 },
  { description: "Uber Eats - Team", suggestion: "Meals & Entertainment", confidence: 88 },
];

const risks = [
  { text: "Cash reserves below 2-month operating threshold", level: "high" as const },
  { text: "3 invoices overdue by 30+ days ($12,400)", level: "medium" as const },
  { text: "Unusual expense spike in marketing (+40% MoM)", level: "low" as const },
];

const recommendations = [
  "Consider early payment to Supplier A for 2% discount ($1,200 savings)",
  "Consolidate 3 bank accounts to reduce monthly fees by $45",
  "Review recurring subscriptions — 2 unused tools detected ($89/mo)",
];

export function AiInsights() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">AI Insights</h2>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
          Premium
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cash Flow Prediction */}
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              Cash Flow Prediction
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {predictions.map((p) => (
              <div key={p.month} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground w-10">{p.month}</span>
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${p.confidence}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    ${p.predicted.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">{p.confidence}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Expense Categorization */}
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Expense Categorization
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {categorizations.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">{c.description}</p>
                  <p className="text-xs text-primary font-medium">→ {c.suggestion}</p>
                </div>
                <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium shrink-0">
                  {c.confidence}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Risk Alerts */}
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Risk Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {risks.map((r, i) => (
              <div key={i} className="flex items-start gap-3">
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                    r.level === "high"
                      ? "bg-destructive"
                      : r.level === "medium"
                      ? "bg-primary"
                      : "bg-muted-foreground"
                  }`}
                />
                <p className="text-sm text-foreground">{r.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Smart Recommendations */}
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              Smart Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-3">
                <ArrowUpRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">{r}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
