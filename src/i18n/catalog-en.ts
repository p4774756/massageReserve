/**
 * English UI strings. Keys match the first argument of `t()` in the codebase.
 * Traditional Chinese fallbacks live next to each `t()` call.
 */
export const EN: Record<string, string> = {
  "meta.docTitle": "Office massage booking",

  "errors.generic": "Something went wrong",
  "errors.firebaseConfig":
    "Firebase is not configured: copy `.env.example` to `.env`, fill in your project settings, then run `npm run dev`.",

  "pwd.show": "Show",
  "pwd.hide": "Hide",
  "pwd.ariaShow": "Show password",
  "pwd.ariaHide": "Hide password",

  "booking.beverageOption": "Buy the therapist a drink",
  "booking.mode.guest_cash": "Guest · cash (NT$50)",
  "booking.mode.guest_beverage": "Guest · drink credit",
  "booking.mode.member_cash": "Member · cash (NT$50)",
  "booking.mode.member_wallet": "Member · wallet (deduct NT$50)",
  "booking.mode.member_beverage": "Member · drink credit",

  "book.tabsAria":
    "Massage booking, my bookings (when signed in), reviews, wheel tab (when signed in), and demo slot machine (rightmost tab)",
  "book.tab.booking": "Book massage",
  "book.tab.guestbook": "Reviews",
  "book.tab.wheel": "Wheel",
  "book.tab.luckySlot": "Slot (demo)",
  "book.tab.myBookings": "My bookings",

  "luckySlot.marqueeLed": "LET'S GO!!!",
  "luckySlot.marqueeSub": "Demo spin · illustrative prizes",
  "luckySlot.leverAria": "Pull lever to spin",
  "luckySlot.reelAdHint": "Reward-ad slot (illustrative)",
  "luckySlot.spin": "Spin",
  "luckySlot.claim": "Claim",
  "luckySlot.claimWithAd": "Watch ad & claim all",
  "luckySlot.hint":
    "Prizes are random client-side demos. Real rewarded ads need Ad Manager / IMA, etc.; if you set window.__MR_rewardedShow(), that implementation runs instead.",
  "luckySlot.spinning": "Spinning…",
  "luckySlot.stopped": "Stopped. Claim, or use the ad demo to “claim all”.",
  "luckySlot.claimed": "Claimed (demo): ",
  "luckySlot.needSpinFirst": "Spin once first.",
  "luckySlot.adTitle": "Reward (demo)",
  "luckySlot.adBody":
    "A real rewarded video would play here. If window.__MR_rewardedShow is set, your SDK runs instead.",
  "luckySlot.adComplete": "Simulate finished watching",
  "luckySlot.adCancel": "Cancel",
  "luckySlot.adCancelled": "Cancelled; nothing granted.",
  "luckySlot.claimedAd": "After ad, claimed all (demo): ",

  "status.pending": "Pending",
  "status.confirmed": "Confirmed",
  "status.done": "Completed",
  "status.cancelled": "Cancelled",
  "status.deleted": "Deleted",

  "guest.yes": "Yes",
  "guest.no": "No",
  "guest.dash": "—",

  "myBooking.cancelReasonLabel": "Cancellation note:",

  "booking.summary.intro": "Please confirm your booking:",
  "booking.summary.name": "Name",
  "booking.summary.date": "Date",
  "booking.summary.start": "Start time",
  "booking.summary.mode": "Payment method",
  "booking.summary.note": "Notes",
  "booking.summary.noteEmpty": "(none)",
  "booking.summary.footer": "Press Confirm to submit.",

  "modal.cancel": "Cancel",
  "modal.close": "Close",
  "modal.confirmDefault": "OK",

  "admin.cancelBooking.title": "Cancel booking",
  "admin.cancelBooking.reasonLabel": "Reason",
  "admin.cancelBooking.reasonPlaceholder": "Reason (optional)",
  "admin.cancelBooking.confirm": "Confirm cancel",

  "home.title": "Office massage booking",
  "home.subtitle":
    "Mon–Fri · 15-minute start slots · session about 15–50 min depending on needs · lunch break 11:45–13:15 closed · latest start 17:30, ends before 18:00",
  "home.guestHint":
    "No sign-up required: choose a guest payment option. Members can top up and join the wheel draw.",
  "home.hostCaption": "A moment of shadow and light is also blank space left for the body.",
  "home.hostAlt":
    "Host portrait: a vertical image composed of gazing, writing at a desk, and contemplation by the window.",

  "visitor.loading": "Loading visit stats…",
  "visitor.badFormat": "Visit stats response was invalid.",
  "visitor.cfFail":
    "Visit stats could not be loaded (deploy Cloud Functions: recordSiteVisit).",
  "visitor.title":
    "Counted once per browser tab session; refresh does not double-count. Taipei calendar day and Mon–Sun week.",
  "visitor.line.today": "Today ",
  "visitor.line.visits": " visits · this week ",
  "visitor.line.total": " · all-time ",
  "visitor.line.youPrefix": "You are visitor #",
  "visitor.line.youSuffix": " today",

  "member.entryLogin": "Member sign-in",
  "member.entryCenter": "Member hub",

  "booking.submit": "Submit booking",
  "booking.spinWheel": "Spin wheel",
  "booking.resendVerify": "Resend verification email",
  "booking.reloadVerify": "I've verified — refresh status",
  "booking.modeHintGuest":
    "Guest bookings settle in cash for NT$50; top-ups and the wheel use sign-in (top right).",
  "booking.pickSlotFirst": "Pick a date to see open slots and quotas.",
  "booking.datePast": "Dates before today cannot be selected.",
  "booking.dateBeyond": "Bookings are only open through the Sunday of next calendar week.",
  "booking.weekdayOnly": "Only Monday–Friday can be booked.",
  "booking.loadSlotsFail": "Could not load availability. Try again later.",
  "booking.dayFull": "This day is fully booked.",
  "booking.weekFull": "This work week has reached its limit.",
  "booking.metaDay": "Booked today ",
  "booking.metaWeek": "Booked this work week ",
  "booking.metaNoteLead": "“Today” means the day you selected: ",
  "booking.metaNoteMid": ". “This work week” is Mon–Fri of that calendar week: ",
  "booking.metaNoteTail": " (same as backend ",
  "booking.metaNoteCode": "weekStart",
  "booking.metaNoteEnd": " quota counts active bookings in that week).",

  "slot.optionPick": "Select a start time",
  "slot.taken": " (taken)",
  "slot.past": " (past)",
  "slot.blocked": " (closed)",
  "slot.blockedWith": " (closed: {{reason}})",

  "field.name": "Name",
  "field.nameHint":
    "No sign-in needed—use a nickname; if you're signed in with a profile name, it may auto-fill (you can edit).",
  "field.date": "Date (Mon–Fri)",
  "field.dateHint": "Farthest selectable date is the Sunday of next week (Taipei); later dates are disabled.",
  "field.startSlot": "Start time (15-minute slots)",
  "field.startSlotHint": "Starts every 15 minutes; session about 15–50 min depending on needs.",
  "field.payment": "Payment method",
  "field.note": "Notes (optional)",
  "field.noteHint": "Needs such as headache, sore back, more leg pressure, etc.",

  "wheel.previewBtn": "Preview wheel effect",
  "wheel.previewTitle": "Preview only — no real spin or deduction",
  "wheel.rules":
    "Wheel rules: after a member booking is marked completed in admin, you earn 1 spin (once per booking). Each Spin uses 1 chance. Prizes are random by admin weights (wallet credit, extra spins, thanks, fun text, etc.). Email verification is required.",
  "wheel.spinNeedLogin": "Please sign in as a member.",
  "wheel.spinNeedVerify": "Please verify your email first.",
  "wheel.spinNoChances": "No spins available.",
  "wheel.spinWonPrefix": "You won: ",
  "wheel.spinDone": "Spin complete!",
  "wheel.previewDone": "That was a visual preview only — no real spin or deduction.",
  "wheel.previewPrizeName": "【Preview】+5 wallet credit",
  "wheel.previewPrizeC10": "+10 wallet credit",
  "wheel.previewPrizeExtra": "One extra spin",
  "wheel.previewPrizeThanks": "Thanks for participating",
  "wheel.previewPrizeFun": "Fun penalty text",

  "support.fab.chat": "Chat",
  "support.fab.collapse": "Close",
  "support.fab.open": "Open contact",
  "support.fab.close": "Close contact",
  "support.fab.hint":
    "Tap: open or close. Press and move slightly (~10px) to drag; release snaps to the bottom-left or bottom-right corner.",

  "music.player.region":
    "Ambient music mini player; use the top bar to drag it to another corner.",

  "music.player.regionCollapsed":
    "Ambient music mini player (collapsed); drag the left grip to move, tap right to expand.",

  "music.float.dragHandle": "Move player: drag the left grip on the top bar",

  "music.float.dragHandleHint":
    "Press and drag to reposition; on release it snaps to the bottom-left or bottom-right corner.",

  "music.float.collapse": "Collapse player",

  "music.float.collapseHint": "Hide track list, progress, and volume; top bar stays for dragging.",

  "music.float.expand": "Expand player",

  "music.float.expandHint": "Show track info, progress, and controls again.",

  "booking.fillName": "Please enter your name.",
  "booking.pickDateSlot": "Please choose a date and start time.",
  "booking.noPastDate": "Cannot book dates before today.",
  "booking.noBeyond": "Bookings only through the Sunday of next week.",
  "booking.slotPast": "That start time has passed — pick a later slot.",
  "booking.memberModeNeedLogin": "Member payment requires sign-in.",
  "booking.memberNeedVerify":
    "Member payment needs a verified email — check your inbox for the verification link.",
  "booking.walletShort":
    "Insufficient wallet balance — switch to cash, “buy a drink”, or top up first.",
  "booking.confirmTitle": "Confirm booking",
  "booking.confirmSubmit": "Confirm submit",
  "booking.cancelledSubmit": "Submission cancelled.",
  "booking.submitted":
    "Submitted! Status is “pending”; actual timing may be adjusted on site.",
  "booking.submittedMyBookingsHint":
    "Open the “My bookings” tab above to check your booking status.",

  "myBookings.title": "My bookings",
  "myBookings.tabsAria": "My bookings categories",
  "myBookings.tab.upcoming": "Upcoming",
  "myBookings.tab.ended": "Ended",
  "myBookings.intro":
    "Bookings tied to your account (member payment methods). Guest bookings do not appear here. “Upcoming” lists pending/confirmed bookings before their start time; everything else is under “Ended”.",
  "myBookings.emptyUpcoming":
    "No upcoming bookings. After you submit with member wallet/cash/drink credit, pending or confirmed bookings before their start time appear here.",
  "myBookings.emptyEnded":
    "No ended records yet (completed, cancelled, deleted, or start time has passed).",
  "myBookings.cancel": "Cancel booking",
  "myBookings.confirmCancelBody": "Cancel this booking?\n\n{{when}}",
  "myBookings.loadFail":
    "Could not load bookings. If you just added an index, deploy and wait for indexing.",
  "myBookings.cancelFail": "Cancel failed",

  "member.verifyBanner":
    "Signed in, but email is not verified. Open the link in your email, then tap “I've verified — refresh status”.",
  "member.walletLoading": "Loading member balance…",
  "member.walletLine": "Signed in: wallet balance {{balance}} (NTD), spin chances {{chances}}.",
  "member.wheelLuck": "You can spin — good luck!",
  "member.wheelNone": "No spins right now.",
  "member.wheelStateFail": "Could not read spin state.",
  "member.wheelNeedVerifyFirst": "Verify your email before spinning the wheel.",

  "member.verifyResent":
    "Verification email sent again — check inbox (and spam).",
  "member.verifyDone": "Verification complete — member features are available.",
  "member.verifyPendingReload":
    "Verification not detected yet — open the link in the email and try again.",

  "auth.modal.title": "Member sign-in / sign-up",
  "auth.login": "Sign in",
  "auth.registerSend": "Register and send verification",
  "auth.resetSend": "Send password reset email",
  "auth.switchRegister": "No account? Register",
  "auth.switchLogin": "Back to sign-in",
  "auth.forgot": "Forgot password?",
  "auth.resetTitle": "Reset password",
  "auth.placeholder.email": "Member email",
  "auth.placeholder.password": "Member password",
  "auth.placeholder.newPassword": "Password (min 6 characters)",
  "auth.placeholder.newPassword2": "Re-enter password",
  "auth.placeholder.resetEmail": "Email used at registration",
  "auth.label.password": "Password",
  "auth.label.confirmPassword": "Confirm password",
  "auth.resetHint":
    "Enter the email used at registration. We'll send a reset link. If nothing arrives, check spam.",
  "auth.loginFail": "Sign-in failed",
  "auth.needEmailPassword": "Enter email and password.",
  "auth.passwordMin": "Password must be at least 6 characters.",
  "auth.passwordMismatch": "The two passwords do not match.",
  "auth.registerSuccess":
    "Registered — verification sent. Open the link, then use “I've verified — refresh” or sign in again.",
  "auth.registerFail": "Registration failed",
  "auth.needEmail": "Enter email.",
  "auth.resetHintSent":
    "If this email is registered, you'll receive a reset message (check spam). Follow the link to set a new password.",
  "auth.resetSendFail": "Send failed",
  "auth.verifySentShort": "Verification email sent.",
  "auth.verifyDoneShort": "Verified.",
  "auth.verifyPendingShort": "Not verified yet — open the link in the email.",

  "member.center": "Member hub",
  "member.anonymousIntro":
    "You're using guest “contact shop”. For wallet, bookings, or the wheel, sign out and use Member sign-in; guest chat history is not merged automatically.",
  "member.anonymousUid": "Anonymous UID: ",
  "member.signedInAs": "Signed in: {{email}} (UID: {{uid}})",
  "member.noEmail": "(no email)",
  "member.verifyModalHint":
    "Verify your email to use wallet, member booking, and the wheel.",
  "member.mode.wallet": "Member wallet (deduct NT$50)",
  "member.mode.cash": "Member cash (NT$50)",
  "member.modeHint.member":
    "Choose wallet deduction, member cash (NT$50), or “buy a drink” (per on-site agreement).",
  "member.modeHint.unverified":
    "Signed in but email not verified — book as guest for now; after verification you can use member payment, wallet, and wheel.",
  "member.modeHint.guest":
    "Guests can pay cash NT$50 or “buy a drink”; wallet and wheel need sign-in (top right).",

  "session.guest": "Guest",
  "session.guestChat": "Guest chat mode",
  "session.guestChatTitle": "Anonymous identity for contacting the shop",
  "session.verifyPending": "Signed in · email pending verification",
  "session.signInLine1": "Signed in ·",
  "session.verifyPendingLine2": "Email pending verification",
  "session.verifyTitleFallback": "No email on file",
  "session.signedInPrefix": "Signed in · ",
  "session.memberFallback": "Member",

  "footer.version": "Version {{ver}} · last update {{date}} (Taipei)",

  "admin.login": "Sign in",
  "admin.resetSend": "Send password reset email",
  "admin.loginHint":
    "Admins only. Create an Email/Password account in Firebase Console, then add a Firestore document ",
  "admin.loginHintEnd": " (can be `{}`).",
  "admin.placeholder.uidDoc": "admins/<your UID>",
  "admin.needEmailFirst": "Enter email first.",
  "admin.resetSentLong":
    "If this email is registered, you'll receive a reset email (check spam). Follow the link to set a new password.",
  "admin.forbidden": "No access: this account is not an admin.",
  "admin.signOut": "Sign out",
  "admin.signedInLabel": "Signed in: {{name}} ({{uid}})",
  "admin.signedInUidOnly": "Signed in: ({{uid}})",
  "admin.placeholder.memberId": "Member email (recommended) or UID",
  "admin.topup.notePlaceholder": "Note (optional)",
  "admin.topup.btn": "Top up",
  "admin.topup.needId": "Enter member email or UID.",
  "admin.topup.amountInt": "Top-up amount must be a positive integer.",
  "admin.topup.processing": "Processing top-up…",
  "admin.topup.ok": "Top-up successful",

  "admin.marquee.saveText": "Save top marquee",
  "admin.marquee.saveLed": "Save bottom LED",
  "admin.marquee.placeholderText": "Top banner e.g. Wed 15:00–16:00 closed",
  "admin.marquee.placeholderLed": "Bottom LED: can be longer, e.g. promo tagline",

  "admin.testStatusEmail.btn": "Test status email",
  "admin.testStatusEmail.title":
    "Send one sample status email to the member (does not change the booking; subject/body marked as test)",
  "admin.testStatusEmail.titleDisabled":
    "Only for bookings linked to a member (guest bookings do not receive status emails)",
  "admin.testStatusEmail.sending": "Sending test email…",
  "admin.testStatusEmail.ok": "Test email sent to {{email}}",
  "admin.testStatusEmail.fail": "Failed to send test email",

  "admin.wheelSpectacle.save": "Save wheel preview toggle",
  "admin.caps.save": "Save booking caps",
  "admin.blocks.addRow": "Add row",
  "admin.blocks.save": "Save closed booking windows",
  "admin.blocks.rowRemove": "Remove this row",
  "admin.blocks.heading": "Closed booking windows",
  "admin.blocks.weekday": "Weekday",
  "admin.blocks.start": "Start (inclusive)",
  "admin.blocks.end": "End (exclusive)",
  "admin.blocks.reason": "Reason shown on the booking page",
  "admin.blocks.reasonPh": "e.g. therapist training, away",
  "admin.blocks.hintA":
    "Disable booking by weekday/time window. If a service slot (~30 min) overlaps a blocked window, that start time is unavailable. Example: Mon/Thu 16:30-17:30 blocks starts at 16:30, 16:45, 17:00. Firestore: ",
  "admin.blocks.hintB": " field ",
  "admin.blocks.hintC": ". Interval is [start, end).",
  "admin.blocks.tooMany": "Maximum 40 rows. Remove some rows and save again.",
  "admin.blocks.invalidWeekday": "Each row weekday must be Monday to Friday.",
  "admin.blocks.invalidTime": "Please check each row time format.",
  "admin.blocks.invalidRange":
    "Each row end time must be later than start time. Intervals are [start, end).",
  "admin.dayLabels": "Mon,Tue,Wed,Thu,Fri",

  "admin.announce.heading": "Marquee announcements",
  "admin.announce.intro":
    "Top and bottom are configured separately in Firestore: siteSettings/marqueeText and siteSettings/marqueeLed. Each supports text, enable, and scroll speed (px/s).",
  "admin.announce.topHeading": "Top · text marquee",
  "admin.announce.topLabel": "Content",
  "admin.announce.enable": "Enable",
  "admin.announce.bottomHeading": "Bottom · LED marquee",
  "admin.announce.bottomLabel": "Content",
  "admin.announce.speedLabel": "Scroll speed",
  "admin.announce.speedHint":
    "About {{min}}–{{max}} (larger number = faster, unit: pixels/second).",
  "admin.announce.wheelHeading": "Booking page · wheel preview",
  "admin.announce.wheelToggle": "Show “Preview wheel effect” on the booking page",
  "admin.announce.wheelHintA":
    "After enabling and saving, the booking page member area shows a “Preview wheel effect” button. It only plays animation, does not call spin API, and does not consume chances. Recommended off in production. Firestore: ",
  "admin.announce.wheelHintB": ".",

  "admin.caps.heading": "Booking caps",
  "admin.caps.perDay": "Max bookings same day",
  "admin.caps.perWeek": "Max bookings same work week",
  "admin.caps.hintA":
    "Controls max active bookings for the same day and same work week (Mon-Fri) with statuses ",
  "admin.caps.hintB": ". Firestore: ",
  "admin.caps.hintC": " (",
  "admin.caps.hintD":
    ", integer 1-50; if doc is missing backend defaults to 2 and 4).",

  "admin.wallet.heading": "Member top-up",
  "admin.wallet.memberLabel": "Member (email or UID)",
  "admin.wallet.searchHint":
    "Type at least 2 characters to match emails, or paste a UID directly.",
  "admin.wallet.amount": "Top-up amount",
  "admin.wallet.note": "Note (optional)",
  "admin.member.createBtn": "Create member account",
  "admin.member.createTitle": "Create member account",
  "admin.member.email": "Member email",
  "admin.member.password": "Initial password",
  "admin.member.nickname": "Display name (optional)",
  "admin.member.nicknameHint":
    "Saved to member profile; if the booking name is empty it may auto-fill; also updates Firebase Auth display name.",
  "admin.member.selfRegisterHint":
    "Members can also self-register on the booking page; they must verify email before wallet and member booking.",
  "admin.member.needCreds": "Enter email and password.",
  "admin.member.emailPh": "Member email",
  "admin.member.passwordPh": "Initial password (min 6 characters)",
  "admin.member.nicknamePh":
    "e.g. Alex (optional; used as default booking name)",
  "admin.member.created": "Created successfully, UID: {{uid}} (top-up field prefilled with email)",

  "admin.table.when": "When",
  "admin.table.name": "Name",
  "admin.table.guest": "Guest",
  "admin.table.guestTitle": "Guest booking?",
  "admin.table.note": "Notes",
  "admin.table.status": "Status",
  "admin.table.actions": "Actions",

  "admin.tab.bookings": "Bookings",
  "admin.tab.hidden": "Hidden bookings",
  "admin.tab.members": "Members & top-up",
  "admin.tab.announce": "Marquee",
  "admin.tab.support": "Support chat",
  "admin.tab.reports": "Reports",

  "admin.reports.intro":
    "Booking figures use the same live snapshot as the Bookings tab. Visitor counts, guestbook, and support threads are read separately. Charts (Chart.js) load when you open this tab: doughnuts for status, payment mode, and support; bar charts for booking volume and visits; polar area for guestbook stars. Wait for the booking list to load, then refresh the report.",
  "admin.reports.refresh": "Refresh report",
  "admin.reports.loading": "Crunching numbers…",
  "admin.reports.ok": "Report updated.",
  "admin.reports.fail": "Could not load report (permissions or network).",
  "admin.reports.updatedAt": "Updated: {{t}}",
  "admin.reports.empty": "No data",
  "admin.reports.card.totalDocs": "Booking documents (total)",
  "admin.reports.card.mainList": "Main list rows",
  "admin.reports.card.hiddenDeleted": "Hidden / deleted",
  "admin.reports.card.todayBookings": "Bookings · today (calendar)",
  "admin.reports.card.weekBookings": "Bookings · this week (Mon–Sun)",
  "admin.reports.card.monthBookings": "Bookings · this month",
  "admin.reports.card.visitsToday": "Site visits · today",
  "admin.reports.card.visitsWeek": "Site visits · this week",
  "admin.reports.card.visitsTotal": "Site visits · all time",
  "admin.reports.card.guestbookCount": "Guestbook posts",
  "admin.reports.card.guestbookAvg": "Guestbook avg. stars",
  "admin.reports.card.supportOpen": "Support threads · open",
  "admin.reports.card.supportClosed": "Support threads · closed",

  "admin.reports.chart.bookingVolumeTitle": "Bookings · today / this week / this month",
  "admin.reports.chart.visitsTitle": "Site visits · today / this week / all time",
  "admin.reports.chart.labelToday": "Today",
  "admin.reports.chart.labelWeek": "This week",
  "admin.reports.chart.labelMonth": "This month",
  "admin.reports.chart.labelTotal": "All time",
  "admin.reports.chart.supportEmpty": "No support threads yet.",
  "admin.reports.chart.legendOpen": "Open",
  "admin.reports.chart.legendClosed": "Closed",
  "admin.reports.chart.starsEmpty": "No guestbook ratings yet.",
  "admin.reports.chart.donutStatus": "Booking status",
  "admin.reports.chart.donutMode": "Payment mode",
  "admin.reports.chart.donutSupport": "Support threads",
  "admin.reports.chart.polarStars": "Guestbook · polar (1–5 stars)",
  "admin.reports.chart.star1": "1 star",
  "admin.reports.chart.star2": "2 stars",
  "admin.reports.chart.star3": "3 stars",
  "admin.reports.chart.star4": "4 stars",
  "admin.reports.chart.star5": "5 stars",

  "admin.hidden.intro":
    "Hidden from the main booking list, or legacy “deleted” in the database. Caps and slots still follow real status (only affects admin list). 10 per page — use Previous/Next below.",

  "admin.pager.prev": "Previous",
  "admin.pager.next": "Next",
  "admin.pager.none": "—",
  "admin.pager.total0": "0 total",
  "admin.pager.hiddenPage": "Page {{cur}} / {{total}} · {{count}} items ({{size}} per page)",
  "admin.pager.memberPage": "Page {{cur}} / {{total}} · {{count}} users ({{size}} per page)",

  "admin.memberList.title": "Member list",
  "admin.memberList.introA": "All Firebase Authentication users merged with Firestore ",
  "admin.memberList.introB": " wallet balance and display name. Large directories may load slowly.",
  "admin.memberList.introSort":
    "Click column headers to sort. Verified email is listed first by default; 10 rows per page.",
  "admin.memberList.reload": "Reload member list",
  "admin.memberList.loading": "Loading member list…",
  "admin.memberList.loaded": "Loaded {{n}} users.",
  "admin.memberList.loadFail": "Load failed",
  "admin.memberList.empty": "No users yet. Tap “Reload member list”.",
  "admin.memberList.saveNick": "Save display name",
  "admin.memberList.nickUpdated": "Updated display name for {{email}}.",
  "admin.memberList.saveFail": "Save failed",
  "admin.memberList.th.email": "Email",
  "admin.memberList.th.verified": "Email verified",
  "admin.memberList.th.uid": "UID",
  "admin.memberList.th.nickname": "Display name",
  "admin.memberList.th.wallet": "Wallet balance",
  "admin.memberList.th.draws": "Spin chances",
  "admin.memberList.th.actions": "Actions",
  "admin.memberList.sortTitle": "Sort by “{{label}}”; click again to reverse",
  "admin.memberList.verifiedYes": "Verified",
  "admin.memberList.verifiedNo": "Not verified",
  "admin.memberList.noEmailCell": "(no email)",

  "admin.hidden.deletedLabel": "Deleted (legacy)",
  "admin.hidden.dash": "—",
  "admin.hidden.unhide": "Unhide",
  "admin.hidden.empty":
    "No bookings hidden from the list or legacy-deleted.",
  "admin.hidden.cancelSummaryIntro": "You are about to cancel this booking. Reason can be empty.",
  "admin.hidden.cancelSummaryNone": "(none)",
  "admin.booking.cancel": "Cancel",
  "admin.booking.hide": "Hide",
  "admin.booking.hideTitleDone": "Completed bookings cannot be cancelled",
  "admin.booking.hideTitleCancelled": "Already cancelled",
  "admin.booking.hideConfirmTitle": "Confirm hide from admin list",
  "admin.booking.hideConfirmBody":
    "Hide this booking from the admin list?\n\n(Status is unchanged; members still see the real status. Caps behave the same as the main list.)\n\nName: {{name}}\nDate: {{date}}\nStart: {{start}}",
  "admin.booking.hideBtn": "Hide",
  "admin.status.updating": "Updating…",
  "admin.status.updated": "Updated",
  "admin.status.updateFail": "Update failed (are you in the admins collection?)",
  "admin.status.cancelling": "Cancelling…",
  "admin.status.cancelled": "Cancelled",
  "admin.status.cancelFail": "Cancel failed",
  "admin.status.processing": "Processing…",
  "admin.status.unhidden": "Restored to main booking list",
  "admin.status.unhideFail": "Restore failed (are you in the admins collection?)",
  "admin.status.hiding": "Hiding…",
  "admin.status.hidden": "Hidden from admin list",
  "admin.status.hideFail": "Hide failed (are you in the admins collection?)",
  "admin.snapshot.loadFail":
    "Could not load bookings (rules, missing index, or admins doc).",

  "admin.backTitle": "Admin",
  "admin.backSubtitle":
    "Use tabs: bookings, hidden bookings, members & top-up, marquee, support chat, reports.",

  "booking.rulesFooter":
    "Rules: max {{dayCap}} same day, max {{weekCap}} same work week; cancelled do not count toward caps.",
  "booking.rulesFooterDefault":
    "Rules: max 2 same day, max 4 same work week; cancelled do not count toward caps.",

  "locale.fieldLabel": "Language",
  "locale.option.zh": "繁體中文",
  "locale.option.en": "English",

  "adminSession.fallbackName": "Admin",

  "supportUi.contactTitle": "Contact",
  "supportUi.guestHint":
    "No account needed — tap below to use an anonymous identity (support chat only). For wallet or bookings, use Member sign-in (top right).",
  "supportUi.guestBtn": "Start as guest",
  "supportUi.inputPh": "Type a message…",
  "supportUi.send": "Send",
  "supportUi.reopen": "Resume chat (reopen thread)",
  "supportUi.hintNone":
    "Signed-in members can contact the shop here; if not signed in, start as guest below. The shop replies from the admin console.",
  "supportUi.hintGuest":
    "You are messaging as a guest; the thread is tied to this browser. Clearing site data or switching devices may lose the thread. Member sign-in enables wallet and bookings (guest chat is not merged automatically).",
  "supportUi.hintMember": "Signed in as a member; the shop will see and reply from the admin console.",
  "supportUi.emptyContent": "Please enter a message.",
  "supportUi.whoShop": "Shop",
  "supportUi.whoMe": "Me",
  "supportUi.whoMember": "Member",
  "supportUi.starAria": "Star rating 1 to 5",
  "supportUi.starsN": "{{n}} stars",
  "supportUi.failSend": "Send failed",
  "supportUi.failReopen": "Could not reopen",
  "supportUi.anonDisabled":
    "Anonymous sign-in is not enabled: Firebase Console → Authentication → Sign-in method → enable Anonymous.",
  "supportUi.failStartGuest": "Could not start guest chat",
  "supportUi.failThread": "Could not load thread status",
  "supportUi.failMsgs": "Could not load messages",
  "supportUi.previewNone": "(no preview)",
  "supportUi.statusOpen": "Open",
  "supportUi.statusClosed": "Closed",
  "supportUi.failList": "Could not load thread list",
  "supportUi.adminTitle": "Support chat",
  "supportUi.adminIntroA": "Left: member threads (open first, then by recent update). Select one to reply on the right. Firestore: ",
  "supportUi.adminIntroB": " and subcollection ",
  "supportUi.adminIntroC": ".",
  "supportUi.threadList": "Threads",
  "supportUi.pickThread": "Pick a thread on the left.",
  "supportUi.markClosed": "Mark closed",
  "supportUi.reopenAdmin": "Reopen",
  "supportUi.replyPh": "Reply to member…",
  "supportUi.replyBtn": "Reply",
  "supportUi.replyEmpty": "Please enter a reply.",
  "supportUi.updateFail": "Update failed",
  "supportUi.failMsgsAdmin": "Could not load messages.",
  "supportUi.guestLabel": "Guest",
  "supportUi.memberLabel": "Member",
  "supportUi.resolving": "Identifying…",
  "supportUi.threadFor": "With {{name}}{{role}}",
  "supportUi.roleMember": "Member",
};
