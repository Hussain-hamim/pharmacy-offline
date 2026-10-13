"""Windows-only Tauri smoke tests. Run against the debug binary and isolated seed_e2e data.
Requires tauri-driver on localhost:4444, matching msedgedriver, and selenium.
No test server or network service is used by the pharmacy application itself.
"""
import os, pathlib, unittest, time, urllib.request
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.options import BaseOptions

class TauriOptions(BaseOptions):
    @property
    def default_capabilities(self): return {}
    def to_capabilities(self):
        return {'tauri:options': {'application': str(pathlib.Path(os.environ['PHARMACY_TEST_BINARY']).resolve())}}

class DesktopSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.name != 'nt': raise unittest.SkipTest('Requires Windows WebView2')
        for attempt in range(100):
            try:
                urllib.request.urlopen('http://127.0.0.1:4444/status',timeout=1).close(); break
            except OSError: time.sleep(0.1)
        cls.driver=webdriver.Remote(command_executor='http://127.0.0.1:4444',options=TauriOptions())
        cls.wait=WebDriverWait(cls.driver,30)
        cls.driver.set_window_size(1366,768)
    @classmethod
    def tearDownClass(cls): cls.driver.quit()
    def tearDown(self):
        pathlib.Path('test-results').mkdir(exist_ok=True)
        self.driver.save_screenshot('test-results/windows-desktop.png')
        pathlib.Path('test-results/windows-desktop.html').write_text(self.driver.page_source,encoding='utf-8')
        pathlib.Path('test-results/windows-url.txt').write_text(self.driver.current_url,encoding='utf-8')
    def button(self, text):
        return self.wait.until(EC.element_to_be_clickable((By.XPATH,f'//button[normalize-space()="{text}" or @aria-label="{text}"]')))
    def test_desktop_bill_draft_localization(self):
        d=self.driver
        user=self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR,'input[autocomplete="username"]')))
        user.send_keys('e2e')
        d.find_element(By.CSS_SELECTOR,'input[type="password"]').send_keys('desktop-test-2026')
        self.button('Sign in').click()
        self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR,'a[href="#/products"]'))).click()
        self.wait.until(EC.text_to_be_present_in_element((By.TAG_NAME,'body'),'Test Medicine'))
        d.find_element(By.CSS_SELECTOR,'a[href="#/sales/new"]').click()
        self.button('Search products, generic names or barcode…').click()
        self.wait.until(EC.element_to_be_clickable((By.XPATH,'//button[.//strong[text()="Test Medicine"] or contains(.,"Test Medicine")]'))).click()
        qty=self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR,'input[aria-label="Quantity 1"]')))
        qty.clear(); qty.send_keys('2')
        self.button('Save draft').click()
        d.find_element(By.CSS_SELECTOR,'a[href="#/drafts"]').click()
        self.wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,'tbody button'))).click()
        self.wait.until(lambda _: d.find_element(By.CSS_SELECTOR,'input[aria-label="Quantity 1"]').get_attribute('value')=='2')
        self.button('Paid').click()
        self.button('Post invoice').click()
        self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR,'dialog[open]')))
        self.wait.until(EC.text_to_be_present_in_element((By.CSS_SELECTOR,'dialog[open]'),'Invoice posted'))
        self.assertIn('40.00',d.find_element(By.CSS_SELECTOR,'dialog[open]').text)
        self.button('Close').click()
        for code in ['fa','ps','en']:
            Select(d.find_element(By.CSS_SELECTOR,'header select, .topbar select')).select_by_value(code)
            self.wait.until(lambda _: d.find_element(By.TAG_NAME,'html').get_attribute('dir') == ('ltr' if code=='en' else 'rtl'))
        for route in ['customers','suppliers','stock','payments','returns','expenses','reports','users','settings','backups','audit']:
            print(f'Checking desktop route: {route}',flush=True)
            d.find_element(By.CSS_SELECTOR,f'a[href="#/{route}"]').click()
            self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR,'h1')))
            self.assertNotIn('Unable to display this screen',d.find_element(By.TAG_NAME,'body').text)
        pathlib.Path('test-results').mkdir(exist_ok=True)
        d.save_screenshot('test-results/windows-desktop.png')
if __name__=='__main__': unittest.main()
