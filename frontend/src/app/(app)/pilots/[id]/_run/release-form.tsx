import { milestoneAction } from "@/app/pilots/actions";
import { SubmitButton, TextField } from "@/components/app/forms";
import { money } from "@/lib/format";
import type { Milestone } from "@/lib/types";

/** Record a payment release. One per milestone; the amount must match the approved one. */
export function ReleaseForm({ milestone, back, withRemarks = false }: { milestone: Milestone; back: string; withRemarks?: boolean }) {
  return (
    <form action={milestoneAction} className="flex flex-col gap-4">
      <input type="hidden" name="milestone_id" value={milestone.id} />
      <input type="hidden" name="action" value="record-release" />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="version" value={milestone.version} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={"ref_" + milestone.id}
          label="Payment reference number"
          name="reference_no"
          required
          minLength={3}
          placeholder="Treasury voucher or advice no."
          className="sm:col-span-2"
        />
        <TextField
          id={"amount_" + milestone.id}
          label="Amount in rupees"
          name="amount_rupees"
          type="number"
          step="0.01"
          defaultValue={milestone.amount_paise / 100}
          required
          className="[&_input]:tabular-nums"
        />
        <TextField id={"released_" + milestone.id} label="Date of release" name="released_on" type="date" optional />
        <TextField id={"mode_" + milestone.id} label="Mode" name="mode" defaultValue="Bank transfer" className={withRemarks ? undefined : "sm:col-span-2"} />
        {withRemarks && <TextField id={"remarks_" + milestone.id} label="Remarks" name="remarks" optional />}
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted-foreground">Only one release can be recorded per milestone. The startup is notified with the reference.</p>
        <SubmitButton
          variant="brand"
          pendingLabel="Recording"
          confirmTitle="Record this release?"
          confirm={`This records ${money({ paise: milestone.amount_paise })} as released for milestone ${milestone.seq}. It cannot be recorded twice.`}
          confirmLabel="Record the release"
          className="shrink-0"
        >
          Record the release
        </SubmitButton>
      </div>
    </form>
  );
}
