import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, User, Lock, Mail, Settings as SettingsIcon } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Header } from "@/components/Header";

export default function Settings() {
  const { user } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords don't match",
        description: "Please make sure your new passwords match.",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
      });
      return;
    }

    setChangingPassword(true);

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to change password",
        description: error.message,
      });
    } else {
      toast({
        title: "Password changed",
        description: "Your password has been successfully updated.",
      });
      setNewPassword("");
      setConfirmPassword("");
    }

    setChangingPassword(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="px-6 lg:px-10 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="text-muted-foreground hover:text-foreground mb-6 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-3">
            <SettingsIcon className="h-6 w-6" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Manage your account and security preferences.
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Account Information */}
          <Card className="border border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                Account Information
              </CardTitle>
              <CardDescription>
                View your account details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Mail className="h-3.5 w-3.5" />
                  Email Address
                </Label>
                <Input
                  value={user?.email || ""}
                  disabled
                  className="bg-muted/50"
                />
                <p className="text-xs text-muted-foreground">
                  Email address cannot be changed
                </p>
              </div>

              {permissions.role && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-sm">Role</Label>
                  <Input
                    value={permissions.role.charAt(0).toUpperCase() + permissions.role.slice(1)}
                    disabled
                    className="bg-muted/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Contact an administrator to change your role
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Change Password */}
          <Card className="border border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>
                Update your password to keep your account secure
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-sm">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <Button type="submit" disabled={changingPassword} size="sm">
                  {changingPassword ? "Changing Password..." : "Change Password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
