"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { VisitTracker } from "@/features/home/VisitTracker";
import { CameraDock } from "@/components/patient/CameraDock";
import { ConfirmRequestDialog } from "@/components/patient/ConfirmRequestDialog";
import { EyeCursor } from "@/features/eyespeak/EyeCursor";
import { PerceptionProvider } from "@/features/perception/PerceptionProvider";
import { RequestProvider } from "@/features/requests/RequestProvider";
import { SignalTriggers } from "@/features/requests/SignalTriggers";
import { SignalRecorder } from "@/features/risk/SignalRecorder";
import { PatientProfileProvider } from "@/features/session/PatientProfileProvider";
import { usePatientProfile } from "@/features/session/usePatientProfile";

function ConnectionPill() {
  const { isLocalDemo, error } = usePatientProfile();
  if (error) return <StatusPill tone="alert">Not connected</StatusPill>;
  return isLocalDemo ? <StatusPill tone="warn">On-device demo</StatusPill> : <StatusPill tone="good">Caregiver linked</StatusPill>;
}

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <PerceptionProvider>
      <PatientProfileProvider>
        <RequestProvider>
          <SignalTriggers />
          <SignalRecorder />
          <VisitTracker />
          <DashboardShell role="patient" sidebarFooter={<CameraDock />} topbarExtra={<ConnectionPill />}>
            {children}
          </DashboardShell>
          <ConfirmRequestDialog />
          <EyeCursor />
        </RequestProvider>
      </PatientProfileProvider>
    </PerceptionProvider>
  );
}
