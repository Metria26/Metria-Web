# Metria — User Guide for Teaching Assistants (TAs)

This guide walks you through everything a TA can do in Metria today, screen by screen. It is written for day-to-day use — no technical knowledge needed. Everything below describes the current version of the app (October 2026).

---

## 1. What you can do as a TA

- Set up a course: create the course, open it as an offering for a term, add sections and assessments.
- Enroll students into sections using their university email, or import a whole class from a CSV of roll numbers.
- Post announcements to a section (they appear on students' dashboards).
- Enter marks by hand or import them from a CSV file.
- See class analytics for your offering (averages, distributions, per-section comparisons).
- Create evaluation booking periods and slots, and watch who has booked.

If a button described here does not work or you are told you do not have permission, your account has not been set up as course staff yet — ask the platform administrator to enable staff access for you.

---

## 2. Signing in

1. Open the Metria website and choose **Open app** (or go straight to the sign-in page).
2. Click **Continue with Google** and pick your university Google account (`@lhr.nu.edu.pk`).
3. You land on your **Dashboard**.

If your Google account uses a different email domain, you will see an **Access not granted** page — sign in with your university account instead.

If you can sign in but everything looks empty and you have no staff options, contact the platform administrator. New accounts are not automatically made course staff.

---

## 3. Finding your way around

On a computer, the left sidebar shows:

| Menu item | What it is for |
| --- | --- |
| **Dashboard** | Your overview page |
| **Courses** | Course setup, enrollments, marks, announcements, analytics |
| **Bookings** | Evaluation periods and slots (staff side) |
| **Calendar**, **Messages**, **Profile** | Not available yet — clicking them shows a "Page not found" screen |

On a phone, the bottom bar shows Dashboard, Bookings, Calendar, Messages and Profile. There is no **Courses** entry in the current version, so course setup, enrollments, announcements and marks entry should be done from a computer. The dashboard and booking screens work fine on a phone.

**Sign out** is at the bottom of the sidebar on a computer.

---

## 4. Setting up your course

All of this happens under **Courses**.

### Step 1 — Create the course

1. Go to **Courses** and click **New offering** (top right).
2. In the **Create course** box, fill in:
   - **Course code** — e.g. `CS301` (letters, numbers and hyphens only).
   - **Title** — e.g. `Software Engineering I`.
   - **Description** — optional.
   - **Department** — optional dropdown (if departments exist).
3. Click **Save course**.

### Step 2 — Open it as an offering for a term

Still on the **New offering** page, in the **Create offering** box:

1. Pick the **Course** you just created.
2. Pick the **Term** (e.g. "Fall 2026").
3. Type an **Offering code** — e.g. `CS301-F26`.
4. Click **Save offering**.

Notes:

- If your new course does not appear in the **Course** dropdown, refresh the page — the list updates on reload.
- If the **Term** dropdown is empty, ask the platform administrator to add the term. Terms are created outside the app in the current version.
- Creating the offering automatically makes **you** its staff — this is what unlocks student enrollment, announcements, marks and analytics for it.

### Step 3 — Add sections

1. Open **Courses** and click your offering in the list.
2. In the **Sections** area, fill in **Section code** (e.g. `A`) and **Capacity** (e.g. `40`, optional).
3. Click **Save section**. Repeat for each class group.

You need at least one section before you can enroll students.

### Step 4 — Add assessments

In the **Assessments** area of the offering page:

1. **Title** — e.g. `Quiz 1`.
2. **Type** — Quiz, Exam, Assignment, Project or Other.
3. **Total marks** — the maximum score (e.g. `10`).
4. **Weight (%)** — how much it counts toward the final grade (e.g. `10`).
5. **Section** — optional; leave blank for the whole offering.
6. Click **Save assessment**.

Once saved, each assessment shows an **Enter marks** button for staff.

---

## 5. Enrolling students

On the offering page, in the **Students** area:

1. Pick the **Section**.
2. Type the student's university email (e.g. `student@lhr.nu.edu.pk`).
3. Click **Enroll student**.

The student now appears in the list with their section and status.

If you see:

- **"No student with that email was found in your university"** — check the spelling, and make sure the student has signed in to Metria at least once.
- **"That student is already enrolled in this section."** — nothing to do; they are already in.

### Enrolling a whole class from a CSV

Below the student list, use the **Import students from CSV** panel. This is the fastest way to enroll a full section.

**Prepare your file** — one column of roll numbers (a header row like `roll` is optional):

```
roll
24L-0612
24L-0613
24L-0614
```

Full university emails also work. Limits: up to **2 MB** and **1000 students** per import.

Roll numbers are converted automatically: `24L-0612` becomes `l240612@lhr.nu.edu.pk`.

1. Pick the **Section**.
2. Click **Choose CSV file** and pick your file. The panel shows how many rows are ready, duplicated, or not recognised.
3. Click **Enroll students**. The result box shows **Enrolled now**, **Already enrolled**, **Pending sign-in**, **Duplicates** and **Invalid rows**.

Students who have not signed in to Metria yet cannot be enrolled immediately. They appear under **Pending (awaiting first sign-in)** and are enrolled automatically the first time they sign in with their university Google account. Use **Remove** next to a pending student to cancel that invite.

Re-importing the same list is safe — existing enrollments and pending students are skipped.

---

## 6. Posting announcements

On the offering page, in the **Announcements** area:

1. Choose the **Section** the announcement is for.
2. Type a **Title**.
3. Write your **Message** — you can use **Bold**, **Italic** and **Bulleted list** from the small toolbar.
4. Click **Post announcement**.

Enrolled students of that section see it on their **Dashboard** and on the offering page.

Important: announcements cannot be edited or deleted in the app yet, so double-check the text before posting.

---

## 7. Entering marks by hand

1. Open **Courses → your offering**.
2. Find the assessment and click **Enter marks**.
3. You get the student list for that assessment. For each student:
   - Type the score in the box next to their name.
   - Click **Save**.
4. The status badge next to each student changes from **Pending** to **Graded** once a score is saved.

Rules to remember:

- A score cannot be higher than the assessment's **Total marks**.
- Saving again replaces the previous score — you can correct mistakes.
- Only students enrolled in the offering appear here.

---

## 8. Importing marks from a CSV file

On the same marks page, open the **Import from CSV** panel. This is the fastest way to enter a whole quiz at once.

**Prepare your file** — a plain CSV with two columns and a header row:

```
email,score
student1@lhr.nu.edu.pk,8.5
student2@lhr.nu.edu.pk,10
```

Limits: up to **10 MB** and **10,000 rows**. The columns must be named exactly `email` and `score`.

**Import step by step:**

1. Click **Choose CSV file** and pick your file. The panel confirms the file name and row count.
2. Decide about **Overwrite existing marks**:
   - Unchecked (default): students who already have a mark are skipped.
   - Checked: existing marks are replaced with the file's values.
3. Click **Preview import**. Nothing is saved yet — you get a summary:
   - **Ready** — will be imported.
   - **Existing** — already have a mark (only imported if you checked overwrite).
   - **Not found** — no student with that email in your university.
   - **Duplicates** — the same email appears more than once in the file.
   - **Invalid** — bad email or score (e.g. score above the assessment total).
   - **Total** — all rows in the file.
4. If anything is wrong, the panel lists the exact rows with reasons. Use **Download error rows** to get a CSV of the problems, fix your file, and preview again.
5. When it looks right, click **Confirm import**. You will see a result like **"12 applied · 3 skipped"**.

Notes:

- Marks are only written to the system when you click **Confirm import**.
- If you wait too long, the preview can expire — just preview again.
- **Start over** clears the panel to begin with a new file.

---

## 9. Class analytics

On the offering page, staff see a **Class analytics** section with:

- Per assessment: number of responses, **Average**, **Lowest**, **Highest**, and a distribution chart (below 50, 50–74, 75+).
- **By section**: the average score per section.

If a group is too small, you will see **"Hidden: fewer than 5 students have scores."** This is a privacy rule, not an error — statistics are only shown when at least 5 students have scores, so individual results cannot be guessed.

---

## 10. Evaluation bookings (staff side)

You create the periods and slots; students book themselves in.

### Create a period

1. Go to **Bookings** and click **New period**.
2. Fill in:
   - **Offering** and **Section**.
   - **Title** — e.g. `Midterm evaluation`.
   - **Starts** and **Ends** — the overall window.
   - **Cutoff hours before slot** — how many hours before a slot starts students can no longer book or cancel (default `6`).
3. Click **Create period**.

### Add slots

1. Go back to **Bookings**, find the period, click **View**.
2. In **Add slot**, fill in **Starts**, **Ends**, **Capacity** (e.g. `30`) and **Location** (optional).
3. Click **Add slot**. Repeat for every slot in the period.

### What staff see

- Each slot shows live availability ("X of Y seats open").
- Under each slot, **Booked students** lists who booked and their status.
- As staff you do not book from this page — the booking buttons are for enrolled students.

Cancellations close automatically **cutoff hours before** each slot starts; after that, students (and you) cannot make changes.

---

## 11. Common messages and what they mean

| Message | What to do |
| --- | --- |
| "You do not have permission to do this." | Your account is not set up as course staff. Contact the platform administrator. |
| "No student with that email was found in your university." | Check the spelling; ask the student to sign in to Metria once, then retry. |
| "That student is already enrolled in this section." | No action needed. |
| "Pending (awaiting first sign-in)" | The student has not signed in yet; they are enrolled automatically on their first sign-in. |
| "That already exists. Use a different code or value." | The course/offering/section code is already used. Choose another. |
| "Some fields are invalid. Check the values and try again." | Look for empty or wrongly formatted fields. Codes allow letters, numbers and hyphens only. |
| "The score cannot be higher than the assessment total." | Lower the score, or correct the assessment's total marks. |
| "This import was already submitted with different data." / preview expired | Click **Start over** and preview your file again. |
| The Course dropdown does not show a course you just created | Refresh the page. |
| Term dropdown is empty | Ask the platform administrator to add the term. |
| Session expired / signed out unexpectedly | Sign in again with Google. |

---

## 12. Not available yet (so you don't go hunting)

- Giving another TA/teacher access to your offering (only the creator is staff today — ask the administrator if you need help).
- Editing or deleting an announcement after posting.
- Calendar, Messages and Profile pages.
- Booking swaps, waitlists and reminders.
- Coursework, reviews, chat and messaging.

---

## 13. Quick button reference

| Where | Action |
| --- | --- |
| Courses → New offering | **Save course**, **Save offering** |
| Offering page → Sections | **Save section** |
| Offering page → Assessments | **Save assessment**, **Enter marks** |
| Offering page → Students | **Enroll student**, **Enroll students** (CSV import), **Remove** (pending invite) |
| Offering page → Announcements | **Post announcement** |
| Marks page | **Save** (per student), **Import from CSV**, **Preview import**, **Confirm import**, **Download error rows**, **Start over** |
| Bookings | **New period**, **Create period**, **View**, **Add slot** |
