import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, Users, Loader2, BarChart3 } from "lucide-react";
import { toast } from "sonner";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [companyName, setCompanyName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreateCompany = async () => {
    if (!companyName.trim() || !user) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc("create_tenant_for_user", {
        _tenant_name: companyName.trim(),
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(`Entreprise "${companyName}" créée !`);
      navigate("/");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCompany = async () => {
    if (!joinCode.trim() || !user) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc("join_tenant", {
        _tenant_name: joinCode.trim(),
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(`Entreprise rejointe !`);
      navigate("/");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Bienvenue sur ComptaFlow</h1>
          <p className="text-muted-foreground mt-1">Configurez votre espace de travail pour commencer</p>
        </div>

        {mode === "choose" && (
          <div className="grid gap-4">
            <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setMode("create")}>
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Créer une entreprise</CardTitle>
                  <CardDescription className="text-xs">Nouvelle organisation avec vous en tant qu'administrateur</CardDescription>
                </div>
              </CardHeader>
            </Card>
            <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setMode("join")}>
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Rejoindre une entreprise</CardTitle>
                  <CardDescription className="text-xs">Rejoignez une organisation existante avec un code d'invitation</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}

        {mode === "create" && (
          <Card>
            <CardHeader>
              <CardTitle>Créer votre entreprise</CardTitle>
              <CardDescription>Vous serez l'administrateur de cette organisation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nom de l'entreprise *</Label>
                <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Ex: QUOREICH CI" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setMode("choose")} className="flex-1">Retour</Button>
                <Button onClick={handleCreateCompany} disabled={!companyName.trim() || loading} className="flex-1">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Créer"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === "join" && (
          <Card>
            <CardHeader>
              <CardTitle>Rejoindre une entreprise</CardTitle>
              <CardDescription>Entrez le nom de l'entreprise à rejoindre</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nom de l'entreprise *</Label>
                <Input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Ex: QUOREICH CI" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setMode("choose")} className="flex-1">Retour</Button>
                <Button onClick={handleJoinCompany} disabled={!joinCode.trim() || loading} className="flex-1">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rejoindre"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
