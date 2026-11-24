import { signOut } from "@/app/actions";

import { SubmitButton } from "@/components/forms";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <SubmitButton variant="secondary" pendingLabel="Signing out...">
        Sign out
      </SubmitButton>
    </form>
  );
}
