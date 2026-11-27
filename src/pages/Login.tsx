import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

type AuthMode = "login" | "signup" | "forgot";

export default function Login() {
  const navigate = useNavigate();
  const { signIn, signUp, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t } = useTranslation("auth");
  const copy = {
    title: t(`${mode}.title`), description: t(`${mode}.description`), action: t(`${mode}.action`),
  };

  function changeMode(next: AuthMode) {
    setMode(next);
    setPassword("");
    setErrorMessage(null);
    setNotice(null);
    heading.current?.focus();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        const { error } = await resetPassword(email);
        if (error) setErrorMessage(error.message);
        else {
          setNotice(t("reset_sent"));
          setMode("login");
          setPassword("");
        }
      } else if (mode === "signup") {
        const { error } = await signUp(email, password, fullName);
        if (error) setErrorMessage(error.message);
        else {
          setNotice(t("check_email"));
          setMode("login");
          setPassword("");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          const code = (error as { code?: string }).code;
          setErrorMessage(!code || code === "invalid_credentials" || /invalid login/i.test(error.message)
            ? t("wrong_login") : error.message);
        } else navigate("/");
      }
    } catch {
      setErrorMessage(t("service_unreachable"));
    } finally { setLoading(false); }
  }

  return <AuthShell>
    <Card className="shadow-sm">
      <CardHeader className="gap-2 p-6 sm:p-8">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{copy.title}</h1>
        <CardDescription className="leading-relaxed">{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-0 pt-0 sm:px-8">
        <div className="grid gap-4">
          {errorMessage && <Alert variant="destructive" className="bg-destructive text-destructive-foreground"><AlertDescription>{errorMessage}</AlertDescription></Alert>}
          {notice && <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm leading-relaxed">{notice}</p>}
          <form onSubmit={handleSubmit} aria-label={copy.title} aria-busy={loading}>
            <fieldset disabled={loading} className="grid min-w-0 gap-5">
              <legend className="sr-only">{copy.title}</legend>
              {mode === "signup" && <div className="grid gap-2">
                <Label htmlFor="auth-name">{t("full_name")}</Label>
                <Input id="auth-name" name="name" type="text" autoComplete="name" placeholder={t("full_name_placeholder")}
                  value={fullName} onChange={event => setFullName(event.target.value)} required className="h-12 text-base" />
              </div>}
              <div className="grid gap-2">
                <Label htmlFor="auth-email">{t("email")}</Label>
                <Input id="auth-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  placeholder={t("email_placeholder")} value={email} onChange={event => setEmail(event.target.value)} required className="h-12 text-base" />
              </div>
              {mode !== "forgot" && <div className="grid gap-2">
                <Label htmlFor="auth-password">{t("secret")}</Label>
                <PasswordInput key={mode} id="auth-password" name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password} onChange={event => setPassword(event.target.value)} required minLength={6}
                  aria-describedby={mode === "signup" ? "password-help" : undefined} />
                {mode === "signup" && <p id="password-help" className="text-xs leading-relaxed text-muted-foreground">{t("secret_help")}</p>}
              </div>}
              {mode === "login" && <Button type="button" variant="link" className="h-auto min-h-11 justify-self-end whitespace-normal p-0 text-right"
                onClick={() => changeMode("forgot")}>{t("forgot_link")}</Button>}
              <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal py-3">
                {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ArrowRight aria-hidden="true" />}
                {loading ? t("wait") : copy.action}
              </Button>
            </fieldset>
          </form>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-center gap-x-1 gap-y-0 px-6 pb-6 pt-5 text-center sm:px-8 sm:pb-8">
        <span className="text-sm text-muted-foreground">{mode === "login" ? t("new_here") : t("have_account")}</span>
        <Button type="button" variant="link" disabled={loading} className="h-auto min-h-11 whitespace-normal px-1"
          onClick={() => changeMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? t("signup.title") : t("login.action")}
        </Button>
      </CardFooter>
    </Card>
  </AuthShell>;
}
