import express from 'express';
import session from 'express-session';
import tough from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(session({
  secret: 'some secret here',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

const pad = n => n < 10 ? '0' + n : n;

function createAxiosWithCookies(req) {
  let jar;
  if (req.session.cookieJar) {
    jar = tough.CookieJar.deserializeSync(req.session.cookieJar);
  } else {
    jar = new tough.CookieJar();
  }

  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }));

  return { client, jar };
}

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const { client, jar } = createAxiosWithCookies(req);

    const loginPageResp = await client.get('https://home-access.cfisd.net/HomeAccess/Account/LogOn');
    const $ = cheerio.load(loginPageResp.data);
    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) return res.status(500).json({ error: 'Failed to get login token' });

    const params = new URLSearchParams();
    params.append('__RequestVerificationToken', token);
    params.append('LogOnDetails.UserName', username);
    params.append('LogOnDetails.Password', password);
    params.append('Database', 10);
    params.append('VerificationOption', 'UsernamePassword');

    const loginResp = await client.post(
      'https://home-access.cfisd.net/HomeAccess/Account/LogOn?ReturnUrl=%2fHomeAccess%2f',
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 0,
        validateStatus: status => status === 200 || status === 302
      }
    );

    let loginSuccess = false;

    if (loginResp.status === 302 && loginResp.headers.location.includes('/HomeAccess/')) {
      loginSuccess = true;
      await client.get('https://home-access.cfisd.net' + loginResp.headers.location);
    } else {
      const html = loginResp.data;
      const $$ = cheerio.load(html);

      if ($$('span[id$="FailureText"]').length || /invalid|incorrect/i.test(html)) {
        loginSuccess = false;
      } else if ($$('#hac-StudentSummary').length || /Welcome/i.test(html)) {
        loginSuccess = true;
      }
    }

    if (!loginSuccess) return res.status(401).json({ error: 'Invalid username or password' });

    req.session.cookieJar = jar.serializeSync();
    req.session.username = username;

    res.json({ message: 'Login successful' });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Schedule endpoint
app.post('/schedule', async (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Not logged in' });
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });

  try {
    const { client, jar } = createAxiosWithCookies(req);

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!iso) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });

    const [, yearStr, monthStr, dayStr] = iso;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);

    const formattedDate = `${pad(month)}/${pad(day)}/${year}`;

    const studentId = req.session.username.startsWith('s') ? req.session.username.slice(1) : req.session.username;
    const scheduleUrl = `https://home-access.cfisd.net/HomeAccess/Content/Student/DailySchedule.aspx?student_id=${studentId}&ScheduleDate=${formattedDate}`;
    console.log('[SCHEDULE] Fetching:', scheduleUrl);

    const schedulePage = await client.get(scheduleUrl);
    const $ = cheerio.load(schedulePage.data);
    const schedule = [];

    $('#plnMain_dgSchedule tr.sg-asp-table-data-row, #plnMain_dgSchedule tr.sg-asp-table-data-row-alt')
      .each((_, row) => {
        const cells = $(row).find('td');
        schedule.push({
          period: $(cells[0]).text().trim(),
          course: $(cells[1]).text().trim(),
          description: $(cells[2]).text().trim(),
          teacher: $(cells[3]).text().trim(),
          room: $(cells[4]).text().trim(),
        });
      });

    req.session.cookieJar = jar.serializeSync();

    res.json({ date: formattedDate, schedule });

  } catch (err) {
    console.error('Schedule fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Logout endpoint
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
