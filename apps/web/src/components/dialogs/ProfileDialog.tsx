"use client";
// Profile dialog (HC-SH-027..030): avatar picker, read-only fields until Edit Profile, referral copy.
import {
  Button,
  Copy,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  cn,
  toast,
} from "@hapiecoin/ui";
import { Avatar as AvatarSchema, type User } from "@hapiecoin/schema";
import { useEffect, useState } from "react";
import { useMe, useUpdateProfile } from "@/lib/api/queries";
import { fmtDate } from "@/lib/format";
import { Avatar } from "@/components/header/AppHeader";
import type { DialogProps } from "./SettingsDialogs";

export function ProfileDialog({ open, onOpenChange }: DialogProps) {
  const { data: user } = useMe();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="profile-dialog">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>Your account details</DialogDescription>
        </DialogHeader>
        {user ? <ProfileForm user={user} onClose={() => onOpenChange(false)} /> : <DialogBody>Loading…</DialogBody>}
      </DialogContent>
    </Dialog>
  );
}

export function ProfileForm({ user, onClose }: { user: User; onClose: () => void }) {
  const update = useUpdateProfile();
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [name, setName] = useState(user.name);
  const [mobile, setMobile] = useState(user.mobile ?? "");
  useEffect(() => {
    setName(user.name);
    setMobile(user.mobile ?? "");
  }, [user.name, user.mobile]);

  const pickAvatar = (avatar: User["avatar"]) => {
    update.mutate(
      { name: user.name, avatar, ...(user.mobile ? { mobile: user.mobile } : {}) },
      { onSuccess: () => toast("Avatar updated"), onError: () => toast.error("Could not update avatar") },
    );
  };

  const save = () => {
    if (!name.trim()) {
      toast.error("Validation Error", { description: "Full Name is required" });
      return;
    }
    const digits = mobile.replace(/\D/g, "");
    if (digits && digits.length !== 10) {
      toast.error("Validation Error", { description: "Mobile number must have 10 digits" });
      return;
    }
    update.mutate(
      { name: name.trim(), ...(digits ? { mobile: digits } : {}) },
      {
        onSuccess: () => {
          setEditing(false);
          toast("Profile updated");
        },
        onError: (e) => toast.error("Could not save profile", { description: e.message }),
      },
    );
  };

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(user.referralCode);
    } catch {
      /* clipboard unavailable */
    }
    toast("Copied", { description: "Referral code copied to clipboard" });
  };

  return (
    <>
      <DialogBody>
        <div className="flex flex-col items-center">
          <button
            type="button"
            title="Tap to change avatar"
            aria-label="Tap to change avatar"
            data-testid="avatar-big"
            onClick={() => setPicker(true)}
            className="grid size-16 place-items-center rounded-full border-2 border-primary bg-muted"
          >
            <Avatar avatar={user.avatar} className="size-7" />
          </button>
          <div className="mt-2 text-xs text-muted-foreground">Tap to change avatar</div>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setPicker((p) => !p)}>
            Change
          </Button>
        </div>
        {picker ? (
          <div className="mt-3 text-center" data-testid="avatar-picker">
            <div className="micro mb-2">Choose your avatar</div>
            <div className="flex justify-center gap-3">
              {AvatarSchema.options.map((a) => (
                <button
                  key={a}
                  type="button"
                  title={a}
                  aria-label={a}
                  aria-pressed={a === user.avatar}
                  data-testid={`avatar-${a}`}
                  onClick={() => pickAvatar(a)}
                  className={cn(
                    "grid size-11 place-items-center rounded-full border-2 bg-muted",
                    a === user.avatar ? "border-primary" : "border-border hover:border-muted-foreground",
                  )}
                >
                  <Avatar avatar={a} className="size-5" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <Field label="Full Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" disabled={!editing} data-testid="profile-name" />
          </Field>
          <Field label="Mobile">
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile number" disabled={!editing} className="font-mono" data-testid="profile-mobile" />
          </Field>
          <Field label="Email">
            <Input value={user.email} readOnly disabled />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Referral code">
              {(control) => (
                <div className="flex gap-2">
                  <Input {...control} value={user.referralCode} readOnly disabled className="font-mono" />
                  <Button variant="outline" size="md" iconOnly title="Copy referral code" aria-label="Copy referral code" onClick={() => void copyRef()}>
                    <Copy className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Joined">
              <Input value={fmtDate(user.createdAt)} readOnly disabled className="font-mono" />
            </Field>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {editing ? (
          <Button onClick={save} loading={update.isPending} data-testid="profile-save">
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        ) : (
          <Button onClick={() => setEditing(true)} data-testid="profile-edit">
            Edit Profile
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
