English Study — Scan, Translate & Learn
=======================================
Chrome Side Panel Extension v1.1.0 (Manifest V3)

ইনস্টল করার নিয়ম
-----------------
১. এই ZIP ফাইলটি একটি ফোল্ডারে এক্সট্র্যাক্ট করুন।
২. Chrome খুলে ঠিকানায় লিখুন: chrome://extensions
৩. উপরের ডান কোণে "Developer mode" চালু করুন।
৪. "Load unpacked" চাইতে ক্লিক করে ভেতরের EnglishStudySidePanel ফোল্ডারটি বেছে নিন।
৫. টুলবারে এক্সটেনশন আইকনে ক্লিক করলে ডান পাশে সাইড প্যানেল খুলবে।
   (আইকন না দেখলে Puzzle 🧩 বাটনে ক্লিক করে Pin করুন।)

PDF ফাইল পড়তে
--------------
chrome://extensions → English Study → Details → "Allow access to file URLs" চালু করুন।
এরপর Chrome-এ PDF খুলে সাইড প্যানেল থেকে "স্ক্রিনশট ক্রপ" ব্যবহার করুন।

ব্যবহার
-------
• ক্রপ / স্ক্যান: পেজের ইংরেজি অংশ মাউস দিয়ে টেনে সিলেক্ট করুন, OCR নিজে থেকেই লেখা পড়বে।
• লেখা এডিট করে "অনুবাদ ও শব্দার্থ আপডেট করুন" চাপুন।
• বাক্য কার্ডে ইংরেজি বাক্যের নিচে বাংলা অর্থ; প্রতিটি অংশে আলাদা স্পিকার।
• শব্দভান্ডার: English Word (বাংলায় উচ্চারণ) = বাংলা শব্দার্থ
• US / UK ইংরেজি এবং বাংলা ভয়েস, গতি ০.৫x–১.৮x।
• Export ট্যাব থেকে TXT ডাউনলোড বা প্রিন্ট/PDF স্টাডি চার্ট তৈরি করুন।

নোট
----
• OCR সম্পূর্ণ অফলাইনে চলে (Tesseract.js বান্ডল করা আছে)।
• অনুবাদ ও ক্লাউড ভয়েসের জন্য ইন্টারনেট দরকার; ইন্টারনেট না থাকলে ব্রাউজারের
  নিজের ভয়েস ব্যবহার হয়।
• কোনো স্টাডি ডেটা কোনো সার্ভারে সংরক্ষণ করা হয় না; সব কিছু ব্রাউজার স্টোরেজে থাকে।
  (শুধু IP/শহর দেখানোর জন্য ipwho.is / ipapi.co / ipify.org-এ একটি সাধারণ
  ইন্টারনেট রিকোয়েস্ট যায়।)

নতুন: ইউজার লগইন ও রেজিস্ট্রেশন (v1.1.0)
-----------------------------------------
• সাইড প্যানেলের উপরে ডান কোণে 👤 নেভিগেশন বাটন — এখানে দুটি অপশন:
  "ইউজার লগইন / রেজিস্ট্রেশন" এবং "অ্যাডমিন লগইন"।
• ইউজার ইমেইল (Gmail), ফোন নম্বর অথবা ইউজারনেম দিয়ে অ্যাকাউন্ট খুলতে ও
  লগইন করতে পারে। পাসওয়ার্ড ও কনফার্ম পাসওয়ার্ড অবশ্যই দিতে হবে।
• নতুন অ্যাকাউন্টে ডিফল্ট ৩ দিনের ট্রায়াল থাকে।
• অ্যাকাউন্ট তৈরি/লগইনের পর 👤 মেনু থেকে "আমার অ্যাকাউন্ট" খুলুন:
  মেয়াদ, ডিভাইস, প্রোমো কোড এবং পাসওয়ার্ড পরিবর্তনের অপশন আছে।
• মেয়াদ শেষ হলে পড়াশোনার কাজ (অনুবাদ, OCR, TTS, Export, Print) বন্ধ হয়ে যায়,
  কিন্তু অ্যাকাউন্ট মডাল খুলে প্রোমো কোড দিয়ে মেয়াদ বাড়ানো যায়।
• ভুল পাসওয়ার্ড বারবার দিলে সাময়িক লক হয় (ডিফল্ট ৫ বার → ১০ মিনিট)।

অ্যাডমিন সেটআপ (প্রথমবার)
-------------------------
১. উপরের 👤 মেনু → "অ্যাডমিন লগইন" চাপুন।
২. প্রথমবার খুললে "অ্যাডমিন পাসওয়ার্ড সেটআপ" দেখাবে — একটি শক্ত পাসওয়ার্ড
   (কমপক্ষে ৮ অক্ষর, একটি ইংরেজি অক্ষর, একটি সংখ্যা ও একটি চিহ্ন) দুইবার লিখে
   সেভ করুন। এই পাসওয়ার্ডই পরে অ্যাডমিন প্যানেল খুলবে।
৩. চাইলে লোড করার আগে js/auth.js ফাইলের ভেতরে
   BOOTSTRAP_ADMIN_PASSWORD = '' এর মধ্যে নিজের পাসওয়ার্ড বসিয়ে দিতে পারেন।
   (পাসওয়ার্ড শুধু PBKDF2-SHA256 হ্যাশ হিসেবে সংরক্ষিত হয়, প্লেইন টেক্সট নয়।)
৪. অ্যাডমিন প্যানেলে ঢোকার পর Security সেকশন থেকে যেকোনো সময় পাসওয়ার্ড
   পরিবর্তন করা যায়। পুরোনো পাসওয়ার্ড আর কাজ করবে না।

অ্যাডমিন প্যানেল
-----------------
মেনু → "অ্যাডমিন লগইন" (বা সেশন থাকলে "অ্যাডমিন প্যানেল") — আলাদা ট্যাবে খুলবে।
সেশন মেয়াদ (ডিফল্ট ২০ মিনিট) নিষ্ক্রিয় থাকলে স্বয়ংক্রিয়ভাবে লক হয়ে যায়।
ব্রাউজার বন্ধ করলে অ্যাডমিন সেশনও মুছে যায়।

• ড্যাশবোর্ড: মোট/সক্রিয়/মেয়াদোত্তীর্ণ ইউজার, প্রোমো ও লগের সারসংক্ষেপ।
• ইউজার: নাম/ইমেইল/ফোন/ইউজারনেম সার্চ ও ফিল্টার; বিস্তারিত দেখুন।
  - মেয়াদ: ২ / ৩ / ৭ দিনের দ্রুত বাটন (আজ থেকে নতুন মেয়াদ) অথবা
    নির্দিষ্ট তারিখ-সময় (Custom) দিয়ে সরাসরি মেয়াদ নির্ধারণ।
  - মেয়াদ শেষ হলে অ্যাক্সেস স্বয়ংক্রিয়ভাবে বন্ধ হয়।
  - ব্যান / সাসপেন্ড / আনব্যান।
  - Force logout — যেকোনো ডিভাইস থেকে লগআউট করান।
  - পাসওয়ার্ড রিসেট — একটি অস্থায়ী পাসওয়ার্ড তৈরি হয়।
  - ইউজার ডিলিট — নিশ্চিত করতে DELETE লিখতে হয়।
  - CSV এক্সপোর্ট।
• প্রোমো: কোড ও কত দিনের অ্যাক্টিভেশন তা দিয়ে নতুন কোড তৈরি করুন।
  কোড নিষ্ক্রিয়/এডিট/ডিলিট করা যায়। একজন ইউজার একটি কোড একবারই ব্যবহার করতে পারে।
• লগ: লগইন/লগআউট, ব্যর্থ লগইন, ডিভাইস মডেল, ব্রাউজার, স্ক্রিন, IP ও শহর,
  অ্যাডমিন কাজ এবং ইন-অ্যাপ অ্যাক্টিভিটি (অনুবাদ, OCR, Export, Print)।
  গ্রুপ/সার্চ/তারিখ ফিল্টার ও CSV এক্সপোর্ট আছে।
• সেটিংস: লগইন বাধ্যতামূলক চালু/বন্ধ, ট্রায়াল দিন, সেশন সময়, লগ সীমা ইত্যাদি।
• ব্যাকআপ: সব ইউজার/প্রোমো/লগ JSON হিসেবে ডাউনলোড; ফ্যাক্টরি রিসেটের জন্য
  RESET লিখে নিশ্চিত করতে হয়।

গুরুত্বপূর্ণ
-----------
• এটি ক্লায়েন্ট-সাইড (লোকাল) সিস্টেম। পাসওয়ার্ড হ্যাশ ও ডেটা chrome.storage.local-এ
  থাকে; সেশন chrome.storage.session-এ (মেমোরি) থাকে। যে ব্যক্তির কম্পিউটার/প্রোফাইলে
  পূর্ণ অ্যাক্সেস আছে সে DevTools দিয়ে ডেটা দেখতে পারে — ইন্টারনেট-ভিত্তিক
  অ্যাকাউন্টের জন্য একটি সার্ভার দরকার।
• অ্যাডমিন পাসওয়ার্ড ভুলে গেলে তা ফেরানো যায় না (হ্যাশ থেকে পাসওয়ার্ড বের করা
  সম্ভব নয়)। সমাধান: chrome://extensions → English Study → Remove করে
  আবার Load unpacked করুন; এতে সব ইউজার, প্রোমো ও লগ মুছে নতুন করে সেটআপ হবে।
  (আগে Backup নিয়ে রাখলে সেই JSON সংরক্ষণ করতে পারেন।)

English quick start
-------------------
1. Extract the ZIP.
2. Open chrome://extensions and enable Developer mode.
3. Click "Load unpacked" and select the EnglishStudySidePanel folder.
4. Click the toolbar icon to open the side panel.
5. For local PDFs, open the extension Details page and enable
   "Allow access to file URLs".

User login and registration
---------------------------
• Use the 👤 button at the top right of the side panel.
• Register with an email (Gmail works), phone number or username plus a password.
  Every new account starts with a 3-day trial.
• Open "My account" to see validity, devices, redeem a promo code or change the
  password. When validity ends, study actions stop but the account modal still
  opens so a promo code can be redeemed.
• Repeated wrong passwords temporarily lock the account (5 tries / 10 minutes).

Admin setup and panel
---------------------
• First open: 👤 menu → "Admin login". Set a strong admin password
  (8+ characters with a letter, a number and a symbol). Only its PBKDF2-SHA256
  hash is stored. You can also set BOOTSTRAP_ADMIN_PASSWORD in js/auth.js before
  loading the extension.
• The panel opens in its own tab, auto-locks after 20 idle minutes, and the
  session is cleared when the browser closes.
• Change the admin password any time in the Security section; the old password
  stops working immediately.
• Manage users (validity 2/3/7 days or a custom date, ban/suspend, force logout,
  password reset, delete, CSV), promo codes with activation durations, and
  logs (device model, browser, screen, IP/city, login times, in-app activity).
  Settings and JSON backup / factory reset are included.

Note: this is a local (client-side) system. Data and password hashes live in
chrome.storage.local and sessions live in chrome.storage.session, so someone
with full access to the computer/profile can inspect them via DevTools. Use a
server-backed account system if protection from a local administrator is needed.
If the admin password is lost it cannot be recovered; remove and reload the
extension from chrome://extensions to start fresh (export a backup first if you
want to keep records).
