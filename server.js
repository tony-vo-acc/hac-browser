import express from 'express';
import session from 'express-session';
import axios from 'axios';
import tough from 'tough-cookie';
import * as cheerio from 'cheerio';
import path from 'path';

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(session({
  secret: 'some secret here',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

function saveJar(req, jar) {
  req.session.cookieJar = JSON.stringify(jar.toJSON());
}

function loadJar(req) {
  return req.session.cookieJar ? tough.CookieJar.fromJSON(req.session.cookieJar) : new tough.CookieJar();
}

async function attachCookies(jar, url, headers = {}) {
  const cookieString = await jar.getCookieString(url);
  if (cookieString) headers['Cookie'] = cookieString;
  return headers;
}

function storeCookies(jar, url, setCookie) {
  if (!setCookie) return;
  if (!Array.isArray(setCookie)) setCookie = [setCookie];
  setCookie.forEach(c => jar.setCookieSync(c, url));
}

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const loginUrl = 'https://home-access.cfisd.net/HomeAccess/Account/LogOn';
    const jar = loadJar(req);
    let headers = await attachCookies(jar, loginUrl);

    const loginPageResp = await axios.get(loginUrl, { headers });
    storeCookies(jar, loginUrl, loginPageResp.headers['set-cookie']);

    const $ = cheerio.load(loginPageResp.data);
    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) return res.status(500).json({ error: 'Failed to get login token' });

    const params = new URLSearchParams();
    params.append('__RequestVerificationToken', token);
    params.append('LogOnDetails.UserName', username);
    params.append('LogOnDetails.Password', password);
    params.append('Database', 10);
    params.append('VerificationOption', 'UsernamePassword');

    headers = await attachCookies(jar, loginUrl, { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' });
    const loginResp = await axios.post(loginUrl + '?ReturnUrl=%2fHomeAccess%2f', params.toString(), {
      headers,
      maxRedirects: 0,
      validateStatus: status => status === 200 || status === 302
    });
    storeCookies(jar, loginUrl, loginResp.headers['set-cookie']);

    let success = false;
    if (loginResp.status === 302 && loginResp.headers.location.includes('/HomeAccess/')) {
      success = true;
      headers = await attachCookies(jar, 'https://home-access.cfisd.net' + loginResp.headers.location);
      await axios.get('https://home-access.cfisd.net' + loginResp.headers.location, { headers });
    } else {
      const $$ = cheerio.load(loginResp.data);
      if ($$('span[id$="FailureText"]').length || /invalid|incorrect/i.test(loginResp.data)) success = false;
      else if ($$('#hac-StudentSummary').length || /Welcome/i.test(loginResp.data)) success = true;
    }

    if (!success) return res.status(401).json({ error: 'Invalid username or password' });

    saveJar(req, jar);
    req.session.username = username;

    res.json({ message: 'Login successful' });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/schedule', async (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Not logged in' });
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });

  try {
    const jar = loadJar(req);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });

    const [, year, month, day] = m;
    const formattedDate = `${month}/${day}/${year}`;
    const studentId = req.session.username.startsWith('s') ? req.session.username.slice(1) : req.session.username;
    const url = `https://home-access.cfisd.net/HomeAccess/Content/Student/DailySchedule.aspx?student_id=${studentId}&ScheduleDate=${formattedDate}`;

    const headers = await attachCookies(jar, url);
    const page = await axios.get(url, { headers });
    storeCookies(jar, url, page.headers['set-cookie']);

    const $ = cheerio.load(page.data);
    const schedule = [];
    $('#plnMain_dgSchedule tr.sg-asp-table-data-row, #plnMain_dgSchedule tr.sg-asp-table-data-row-alt').each((_, row) => {
      const cells = $(row).find('td');
      schedule.push({
        period: $(cells[0]).text().trim(),
        course: $(cells[1]).text().trim(),
        description: $(cells[2]).text().trim(),
        teacher: $(cells[3]).text().trim(),
        room: $(cells[4]).text().trim(),
      });
    });

    saveJar(req, jar);
    res.json({ date: formattedDate, schedule });
  } catch {
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => err ? res.status(500).json({ error: 'Logout failed' }) : res.json({ ok: true }));
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
