export const errorTranslations: Record<string, [string, string]> = {
  'The local preview server is unavailable. Start the backend and try again.': [
    'سرور محلی پیش‌نمایش در دسترس نیست. بخش پشتیبان را اجرا کرده و دوباره تلاش کنید.',
    'د محلي مخکتنې سرور شتون نه لري. شاتنۍ برخه چالانه کړئ او بیا هڅه وکړئ.',
  ],
  'The local preview server returned an invalid response. Restart it and try again.': [
    'سرور محلی پیش‌نمایش پاسخ نامعتبر داد. آن را دوباره اجرا کرده و تلاش کنید.',
    'د محلي مخکتنې سرور ناسم ځواب ورکړ. بیا یې چالان کړئ او هڅه وکړئ.',
  ],
  'This action requires additional permission': [
    'این عمل به صلاحیت اضافی نیاز دارد',
    'دا کار اضافي اجازې ته اړتیا لري',
  ],
  'Password must contain at least 8 characters': [
    'رمز باید حداقل ۸ حرف باشد',
    'پټنوم باید لږ تر لږه ۸ توري ولري',
  ],
  'Could not secure password': ['ذخیره امن رمز ممکن نشد', 'پټنوم په خوندي ډول ونه ساتل شو'],
  'Setup already completed': ['راه‌اندازی قبلاً تکمیل شده', 'لومړنۍ امستنې بشپړې شوې دي'],
  'First user must be an active administrator': [
    'کاربر اول باید مدیر فعال باشد',
    'لومړی کاروونکی باید فعال مدیر وي',
  ],
  'Name and username are required': ['نام و نام کاربری الزامی است', 'نوم او کارن نوم اړین دي'],
  'Invalid role': ['نقش نامعتبر', 'ناسم رول'],
  'Invalid permission': ['صلاحیت نامعتبر', 'ناسمه اجازه'],
  'Cannot remove the last administrator': [
    'آخرین مدیر را نمی‌توان غیرفعال کرد',
    'وروستی مدیر نه شي غیرفعال کېدای',
  ],
  'Record changed. Reload before saving': [
    'معلومات تغییر کرده؛ پیش از ذخیره دوباره بارگذاری کنید',
    'معلومات بدل شوي؛ له ساتلو مخکې بیا پورته کړئ',
  ],
  'Invalid backup destination': ['مقصد پشتیبان نامعتبر است', 'د بیک اپ ځای ناسم دی'],
  'Backup copy checksum mismatch': [
    'کاپی پشتیبان با اصل مطابقت ندارد',
    'د بیک اپ کاپي له اصل سره نه سمون خوري',
  ],
  'Snapshot integrity check failed': [
    'صحت نسخه پشتیبان تأیید نشد',
    'د بیک اپ بشپړتیا تایید نه شوه',
  ],
  'Unsupported backup format': ['فرمت پشتیبان پشتیبانی نمی‌شود', 'د بیک اپ بڼه نه منل کېږي'],
  'Backup requires a newer application': [
    'پشتیبان به نسخه جدیدتر برنامه نیاز دارد',
    'بیک اپ د پروګرام نوې نسخې ته اړتیا لري',
  ],
  'Invalid or oversized backup': [
    'پشتیبان نامعتبر یا بیش از حد بزرگ است',
    'بیک اپ ناسم یا ډېر لوی دی',
  ],
  'Backup size does not match manifest': [
    'حجم پشتیبان با مشخصات مطابقت ندارد',
    'د بیک اپ اندازه له مشخصاتو سره نه سمون خوري',
  ],
  'Backup checksum verification failed': [
    'صحت فایل پشتیبان تأیید نشد',
    'د بیک اپ فایل تایید ناکام شو',
  ],
  'Backup database is corrupt': ['دیتابیس پشتیبان خراب است', 'د بیک اپ ډېټابېس خراب دی'],
  'Backup contains invalid references': [
    'روابط معلومات پشتیبان نامعتبر است',
    'د بیک اپ د معلوماتو اړیکې ناسمې دي',
  ],
  'Unsupported database version': ['نسخه دیتابیس پشتیبانی نمی‌شود', 'د ډېټابېس نسخه نه منل کېږي'],
  'Database belongs to a newer application version': [
    'دیتابیس مربوط به نسخه جدیدتر برنامه است',
    'ډېټابېس د پروګرام د نوې نسخې دی',
  ],
  'Invalid Gregorian date': ['تاریخ میلادی نامعتبر است', 'میلادي نېټه ناسمه ده'],
  'Enter a valid amount': ['مبلغ درست وارد کنید', 'سم مبلغ ولیکئ'],
  'Invalid amount': ['مبلغ نامعتبر است', 'مبلغ ناسم دی'],
  'Use at most two decimal places': [
    'حداکثر دو رقم اعشاری وارد کنید',
    'تر دوو اعشاري رقمونو پورې ولیکئ',
  ],
  'Amount too large': ['مبلغ بیش از حد بزرگ است', 'مبلغ ډېر لوی دی'],
  'Amount exceeds supported range': ['مبلغ از حد مجاز بیشتر است', 'مبلغ له ټاکلي حد څخه زیات دی'],
  'Too many attempts. Wait 30 seconds': [
    'تلاش‌های زیاد؛ ۳۰ ثانیه صبر کنید',
    'ډېرې هڅې؛ ۳۰ ثانیې انتظار وکړئ',
  ],
  'Another backup is already running': ['پشتیبان‌گیری دیگری در حال اجرا است', 'بل بیک اپ روان دی'],
  'Pharmacy name is required': ['نام دواخانه الزامی است', 'د درملتون نوم اړین دی'],
  'Invalid language': ['زبان نامعتبر', 'ناسمه ژبه'],
  'Invalid calendar': ['تقویم نامعتبر', 'ناسم کلیز'],
  'Expiry alert must be between 1 and 730 days': [
    'هشدار انقضا باید بین ۱ تا ۷۳۰ روز باشد',
    'د ختمېدو خبرتیا باید له ۱ تر ۷۳۰ ورځو وي',
  ],
  'Logo must be smaller than 2 MB': [
    'لوگو باید کمتر از ۲ مگابایت باشد',
    'لوګو باید له ۲ مېګابایټو کوچنی وي',
  ],
  'Invoice prefix must contain 1–12 letters, digits, or hyphens': [
    'پیشوند بل باید ۱ تا ۱۲ حرف، عدد یا خط تیره باشد',
    'د بل مخکښ باید له ۱ تر ۱۲ تورو، شمیرو یا نښلوونکو وي',
  ],
  'Export must be a .csv file': ['فایل خروجی باید CSV باشد', 'صادر شوی فایل باید CSV وي'],
  'Export cancelled': ['صدور لغو شد', 'صادرول لغوه شول'],
  'Application state unavailable; restart the app': [
    'برنامه را دوباره باز کنید',
    'پروګرام بیا پرانیزئ',
  ],
  'Invalid party type': ['نوع حساب نامعتبر است', 'د حساب ډول ناسم دی'],
  'Name is required': ['نام الزامی است', 'نوم اړین دی'],
  'Invalid supplier type': ['نوع تأمین‌کننده نامعتبر است', 'د عرضه کوونکي ډول ناسم دی'],
  'Product name and base unit are required': [
    'نام محصول و واحد پایه الزامی است',
    'د محصول نوم او بنسټیز واحد اړین دي',
  ],
  'Reorder level cannot be negative': [
    'حد سفارش نمی‌تواند منفی باشد',
    'د بیا فرمایش حد منفي نه شي کېدای',
  ],
  'Opening stock can only be added when creating a product': [
    'موجودی ابتدایی فقط هنگام ایجاد محصول اضافه می‌شود',
    'لومړنۍ زېرمه یوازې د محصول جوړولو پر مهال زیاتېدای شي',
  ],
  'A base unit with multiplier 1 is required': [
    'واحد پایه با ضریب ۱ الزامی است',
    'د ۱ ضریب لرونکی بنسټیز واحد اړین دی',
  ],
  'Invalid unit': ['واحد نامعتبر', 'ناسم واحد'],
  'Unit names must be unique': ['نام واحدها باید متفاوت باشد', 'د واحدونو نومونه باید بېل وي'],
  'Unit price cannot be negative': ['قیمت واحد نمی‌تواند منفی باشد', 'د واحد بیه منفي نه شي کېدای'],
  'Base unit cannot change after stock activity': [
    'پس از فعالیت موجودی، واحد پایه تغییر نمی‌کند',
    'د زېرمې له فعالیت وروسته بنسټیز واحد نه بدلېږي',
  ],
  'Existing unit conversions cannot change after stock activity; add a new unit': [
    'تبدیل واحد استفاده‌شده قابل تغییر نیست؛ واحد جدید اضافه کنید',
    'کارول شوی بدلون نه بدلېږي؛ نوی واحد زیات کړئ',
  ],
  'Invalid category': ['کتگوری نامعتبر', 'ناسمه کټګوري'],
  'Expense must be greater than zero': [
    'مصرف باید بیشتر از صفر باشد',
    'لګښت باید له صفر څخه زیات وي',
  ],
  'Select an expense category': ['کتگوری مصرف را انتخاب کنید', 'د لګښت کټګوري وټاکئ'],
  'This draft belongs to another user': ['پیش‌نویس مربوط کاربر دیگر است', 'مسوده د بل کاروونکي ده'],
  'Draft changed. Reload before saving': [
    'پیش‌نویس تغییر کرده؛ دوباره بارگذاری کنید',
    'مسوده بدله شوې؛ بیا یې پورته کړئ',
  ],
  'Draft no longer exists': ['پیش‌نویس دیگر موجود نیست', 'مسوده نور نشته'],
  'Adjustment reason is required': ['دلیل تعدیل الزامی است', 'د سمون دلیل اړین دی'],
  'Invalid stock adjustment': ['تعدیل موجودی نامعتبر', 'د زېرمې سمون ناسم دی'],
  'Invalid base quantity': ['تعداد پایه نامعتبر', 'بنسټیز شمېر ناسم دی'],
  'Quantity must be positive': ['تعداد باید مثبت باشد', 'شمېر باید مثبت وي'],
  'Batch number is required': ['شماره بچ الزامی است', 'د جوپې شمېره اړینه ده'],
  'Cost cannot be negative': ['قیمت تمام‌شده نمی‌تواند منفی باشد', 'لګښت منفي نه شي کېدای'],
  'Expired stock cannot be released': [
    'موجودی منقضی قابل فروش نمی‌شود',
    'ختمه شوې زېرمه د پلور وړ نه شي کېدای',
  ],
  'Use opening stock to replenish an empty batch': [
    'برای بچ خالی، موجودی ابتدایی ثبت کنید',
    'د تشې جوپې لپاره لومړنۍ زېرمه ثبت کړئ',
  ],
  'Product not found': ['محصول یافت نشد', 'محصول ونه موندل شو'],
  'Account not found': ['حساب یافت نشد', 'حساب ونه موندل شو'],
  'Invoice not found': ['بل یافت نشد', 'بل ونه موندل شو'],
  'Draft not found': ['پیش‌نویس یافت نشد', 'مسوده ونه موندل شوه'],
  'User not found': ['کاربر یافت نشد', 'کاروونکی ونه موندل شو'],
  'Discount cannot be negative': ['تخفیف نمی‌تواند منفی باشد', 'تخفیف منفي نه شي کېدای'],
  'Percentage cannot exceed 100': [
    'فیصدی نمی‌تواند بیشتر از ۱۰۰ باشد',
    'سلنه له ۱۰۰ څخه زیاته نه شي کېدای',
  ],
  'Invalid discount type': ['نوع تخفیف نامعتبر', 'د تخفیف ډول ناسم دی'],
  'Discount cannot exceed the line or invoice amount': [
    'تخفیف نمی‌تواند از مبلغ ردیف یا بل بیشتر باشد',
    'تخفیف د قطار یا بل له مبلغ څخه زیات نه شي کېدای',
  ],
  'Quantity or amount is too large': [
    'تعداد یا مبلغ بیش از حد بزرگ است',
    'شمېر یا مبلغ ډېر لوی دی',
  ],
  'Invalid bill type': ['نوع بل نامعتبر', 'د بل ډول ناسم دی'],
  'A bill requires between 1 and 2000 lines': [
    'بل باید بین ۱ تا ۲۰۰۰ ردیف داشته باشد',
    'بل باید له ۱ تر ۲۰۰۰ قطارونه ولري',
  ],
  'Supplier is required': ['انتخاب تأمین‌کننده الزامی است', 'عرضه کوونکی اړین دی'],
  'Select an active customer or supplier': [
    'مشتری یا تأمین‌کننده فعال انتخاب کنید',
    'فعال پېرودونکی یا عرضه کوونکی وټاکئ',
  ],
  'Quantity must be a positive whole number': [
    'تعداد باید عدد صحیح مثبت باشد',
    'شمېر باید مثبت بشپړ عدد وي',
  ],
  'Base quantity is too large': ['تعداد پایه بیش از حد بزرگ است', 'بنسټیز شمېر ډېر لوی دی'],
  'Price cannot be negative': ['قیمت نمی‌تواند منفی باشد', 'بیه منفي نه شي کېدای'],
  'Invoice total is too large': ['مجموع بل بیش از حد بزرگ است', 'د بل ټول مبلغ ډېر لوی دی'],
  'Payment cannot be negative': ['پرداخت نمی‌تواند منفی باشد', 'تادیه منفي نه شي کېدای'],
  'Payment must be greater than zero': [
    'پرداخت باید بیشتر از صفر باشد',
    'تادیه باید له صفر څخه زیاته وي',
  ],
  'Invoice belongs to a different account': ['بل مربوط حساب دیگری است', 'بل د بل حساب دی'],
  'Choose refund or account credit': [
    'بازپرداخت یا اعتبار حساب را انتخاب کنید',
    'بېرته تادیه یا د حساب اعتبار وټاکئ',
  ],
  'Original invoice not found': ['بل اصلی یافت نشد', 'اصلي بل ونه موندل شو'],
  'Returns must reference an original sale or purchase': [
    'برگشتی باید به فروش یا خرید اصلی وصل باشد',
    'ستنېدنه باید له اصلي پلور یا پېرودنې سره تړلې وي',
  ],
  'Walk-in returns must be refunded': [
    'برگشتی مشتری گذری باید بازپرداخت شود',
    'د بې‌حسابه پېرودونکي پیسې باید بېرته ورکړل شي',
  ],
  'Invalid or duplicate return line': [
    'ردیف برگشتی نامعتبر یا تکراری است',
    'د ستنېدنې قطار ناسم یا تکراري دی',
  ],
  'Return line does not belong to this invoice': [
    'ردیف برگشتی مربوط این بل نیست',
    'د ستنېدنې قطار د دې بل نه دی',
  ],
  'Return exceeds remaining returnable quantity': [
    'تعداد برگشتی از مقدار مجاز بیشتر است',
    'د ستنېدنې شمېر له پاتې مجاز شمېر څخه زیات دی',
  ],
  'Expired returned stock must remain quarantined': [
    'برگشتی منقضی باید در قرنطین بماند',
    'ختم شوي بېرته راغلي درمل باید قرنطین وي',
  ],
  'Original batch allocation is incomplete': [
    'تخصیص بچ اصلی کامل نیست',
    'د اصلي جوپې وېش نیمګړی دی',
  ],
  'Not enough stock remains from this purchase': [
    'موجودی کافی از این خرید باقی نمانده',
    'له دې پېرودنې کافي زېرمه نه ده پاتې',
  ],
};
