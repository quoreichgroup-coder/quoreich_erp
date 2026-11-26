import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    // Check for recovery token in URL hash
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    if (password.length < 6) {
      toast.error("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Mot de passe mis à jour !");
      navigate("/");
    }
  };

  if (!isRecovery) {
    return (
      <AuthShell>
        <Card><CardHeader>
          <h1 className="text-xl font-semibold">Lien de récupération indisponible</h1>
          <CardDescription>Ce lien est invalide ou a expiré. Demandez un nouveau lien depuis la connexion.</CardDescription>
        </CardHeader><CardContent>
          <Button variant="outline" onClick={() => navigate("/login")} className="h-auto min-h-11 w-full whitespace-normal py-2">
            Retour à la connexion
          </Button>
        </CardContent></Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card><CardHeader className="p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Nouveau mot de passe</h1>
        <CardDescription>Choisissez un mot de passe d’au moins 6 caractères.</CardDescription>
      </CardHeader><CardContent className="px-6 pb-6 sm:px-8 sm:pb-8">
          <form onSubmit={handleReset} aria-label="Nouveau mot de passe" aria-busy={loading}>
            <fieldset disabled={loading} className="grid min-w-0 gap-5">
              <legend className="sr-only">Nouveau mot de passe</legend>
              <div className="grid gap-2">
                <Label htmlFor="reset-password">Nouveau mot de passe</Label>
                <PasswordInput id="reset-password" name="password" autoComplete="new-password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reset-confirm">Confirmer le mot de passe</Label>
                <PasswordInput id="reset-confirm" name="confirm-password" autoComplete="new-password" minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
              </div>
            <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal py-3" disabled={loading}>
              {loading ? "Mise à jour..." : "Mettre à jour le mot de passe"}
            </Button>
            </fieldset>
          </form>
      </CardContent></Card>
    </AuthShell>
  );
}
