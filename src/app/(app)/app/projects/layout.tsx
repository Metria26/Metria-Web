import { createClient } from "@/lib/supabase/server";
import { StudentProjectGuide } from "@/features/projects/ui/student-guide";

export const instant = false;

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  let isStaff = false;
  if (profile) {
    const { data: staffRows } = await supabase
      .from("offering_staff")
      .select("offering_id")
      .eq("profile_id", profile.id)
      .limit(1);
    isStaff = (staffRows ?? []).length > 0;
  }

  return (
    <>
      {children}
      {profile ? <StudentProjectGuide profileId={profile.id} autoOpen={!isStaff} /> : null}
    </>
  );
}
