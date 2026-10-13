"""Development database only: real API calls, never loaded by the desktop app."""
import json, urllib.request, datetime, uuid
URL = 'http://127.0.0.1:1421/api'
token = None
def api(action, payload=None):
    body=json.dumps({'action':action,'payload':payload or {},'token':token}).encode()
    request=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request) as response: return json.load(response)
    except urllib.error.HTTPError as e: raise RuntimeError(e.read().decode()) from e
if api('bootstrap')['needs_setup']:
    session=api('setup',{'name':'Ahmad Rahimi','username':'admin','password':'demo-pharmacy-2026','role':'Administrator','pharmacy_name':'Radefy Pharmacy'})
else:
    session=api('login',{'username':'admin','password':'demo-pharmacy-2026'})
token=session['token']
if api('list',{'entity':'products','limit':1})['items']:
    print('Development database already contains products; leaving it unchanged.')
    raise SystemExit
settings=api('settings');settings.update({'calendar':'gregory','address':'Shahr-e Naw, Kabul, Afghanistan','phone':'+93 700 123 456','language':'en'})
api('save_settings',{'settings':settings,'request_id':str(uuid.uuid4())})
suppliers=[api('save_party',{'kind':'supplier','name':name,'phone':phone,'address':'Kabul, Afghanistan','type_id':1,'opening':'0'})['id'] for name,phone in [('Ariana Medical Supply','0700 341 200'),('Kabul Pharma Distribution','0799 220 300'),('Shifa Pharmaceuticals','0788 915 000')]]
customers=[api('save_party',{'kind':'customer','name':name,'phone':f'0700 45{i:04d}','address':'Kabul','opening':'0'})['id'] for i,name in enumerate(['Mohammad Akbar','Fatima Azizi','Omid Safi','Laila Rahmani','Zahir Ahmadi','Nadia Noori','Sayed Farid','Maryam Hosseini'])]
medicines=[('Paracetamol 500 mg','Acetaminophen','Pain relief',12,8,220),('Amoxicillin 250 mg','Amoxicillin','Antibiotics',35,22,150),('Cetirizine 10 mg','Cetirizine','Allergy',18,10,110),('Omeprazole 20 mg','Omeprazole','Digestive care',28,17,190),('Metformin 500 mg','Metformin','Diabetes',16,9,130),('Vitamin D3 1000 IU','Cholecalciferol','Vitamins',25,14,100),('Ibuprofen 400 mg','Ibuprofen','Pain relief',20,12,160),('Azithromycin 500 mg','Azithromycin','Antibiotics',65,42,80),('Loratadine 10 mg','Loratadine','Allergy',22,14,120),('Amlodipine 5 mg','Amlodipine','Cardiovascular',19,11,140),('Salbutamol inhaler','Salbutamol','Respiratory',280,190,4),('Oral rehydration salts','ORS','Digestive care',15,8,5),('Vitamin C 500 mg','Ascorbic acid','Vitamins',14,7,7),('Insulin 100 IU/ml','Human insulin','Diabetes',490,350,3)]
products=[]
today=datetime.date.today()
for i,(name,generic,category,price,cost,qty) in enumerate(medicines):
    product=api('save_product',{'name':name,'generic':generic,'strength':name.split(' ',1)[-1],'form':'Tablet' if i<10 else 'Other','category':category,'manufacturer':'Ariana Pharma','barcode':f'89012345{i:04d}','shelf':f'{chr(65+i//5)}-{i%5+1:02d}','base_unit':'tablet' if i<10 else 'unit','reorder_level':10,'units':[{'name':'tablet' if i<10 else 'unit','multiplier':1,'price':str(price)},{'name':'strip','multiplier':10,'price':str(price*10)},{'name':'box','multiplier':100,'price':str(price*100)}]})['id']
    unit=api('detail',{'entity':'product','id':product})['units'][0]['id']
    products.append((product,unit,price))
    api('post_bill',{'kind':'purchase','party_id':suppliers[i%3],'date':str(today-datetime.timedelta(days=30)),'request_id':str(uuid.uuid4()),'lines':[{'product_id':product,'unit_id':unit,'quantity':qty,'price':str(cost),'batch_number':f'BT-26-{i+1:03d}','expiry':str(today+datetime.timedelta(days=45 if i in [2,13] else 365+i*20))}],'paid':str(cost*qty//2),'method':'Bank transfer'})
for day in range(25):
    for j in range(2):
        index=(day+j)%10
        product,unit,price=products[index]
        quantity=(day%3)+1
        api('post_bill',{'kind':'sale','party_id':customers[(day+j)%len(customers)],'date':str(today-datetime.timedelta(days=24-day)),'request_id':str(uuid.uuid4()),'lines':[{'product_id':product,'unit_id':unit,'quantity':quantity,'price':str(price)}],'paid':str(price*quantity if day%4 else price*quantity//2),'method':'Cash'})
categories={c['name']:c['id'] for c in api('list',{'entity':'categories','kind':'expense'})['items']}
for name,amount,note in [('Rent','12000','October shop rent'),('Utilities','1850','Electricity and water'),('Transport','650','Supplier delivery')]:
    category=categories[name]
    api('post_expense',{'request_id':str(uuid.uuid4()),'category_id':category,'amount':amount,'date':str(today),'method':'Cash','note':note})
print('Seeded isolated development database. Username: admin | Password: demo-pharmacy-2026')
