//! Reserve server (docs/FALLBACK.md): when the main server fails for real, the same check goes to the
//! reserve server. Logic only, testable with a fake backend and a fake clock.
//!
//! The "main server is down" mark lives in [`DownState`], shared by every check for as long as the
//! app runs. While it is set, checks go straight to the reserve and a background thread probes
//! `GET /api/health` of the main server at most once a minute to switch back.

use crate::api::{ApiError, Backend, CheckApi, Request};
use serde_json::Value;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Main server, believed up.
pub const PRIMARY_TIMEOUT: Duration = Duration::from_millis(4500);
/// Reserve server, at most.
pub const RESERVE_TIMEOUT: Duration = Duration::from_secs(6);
/// Whole check, both servers.
pub const TOTAL_BUDGET: Duration = Duration::from_secs(8);
/// A second try with less than this left is pointless.
pub const MIN_LEFT: Duration = Duration::from_millis(1500);
/// How long the main server stays marked down.
pub const DOWN_FOR: Duration = Duration::from_secs(300);
/// Health probe of the main server while it is marked down.
pub const PROBE_EVERY: Duration = Duration::from_secs(60);

/// Monotonic time since an arbitrary start.
pub trait Clock: Send + Sync {
    fn now(&self) -> Duration;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Duration {
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed()
    }
}

#[derive(Debug, Clone)]
struct Down {
    until: Duration,
    probe_at: Option<Duration>,
    /// Why the main server failed (reported when the reserve fails too).
    error: ApiError,
    probing: bool,
}

/// Shared "main server is down" mark.
#[derive(Default)]
pub struct DownState(Mutex<Option<Down>>);

impl DownState {
    pub fn new() -> Arc<DownState> {
        Arc::new(DownState::default())
    }

    pub fn is_down(&self, now: Duration) -> bool {
        self.0.lock().unwrap().as_ref().map_or(false, |d| d.until > now)
    }

    fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}

/// The reserve address that applies: only while the effective server is the built-in address, and only a
/// valid address that differs from it. A user's own server never gets a foreign reserve.
pub fn reserve_for(server: &str, preset: &str, fallback: &str) -> Option<String> {
    let main = crate::link::valid_server(server)?;
    let p = crate::link::valid_server(preset)?;
    let r = crate::link::valid_server(fallback)?;
    (main == p && r != main).then_some(r)
}

pub struct FailoverApi<B: Backend + Send + Sync + 'static> {
    main: Arc<B>,
    reserve: Option<Arc<B>>,
    state: Arc<DownState>,
    clock: Arc<dyn Clock>,
}

impl<B: Backend + Send + Sync + 'static> FailoverApi<B> {
    pub fn new(main: B, reserve: Option<B>, state: Arc<DownState>) -> Self {
        Self::with_clock(main, reserve, state, Arc::new(SystemClock))
    }

    pub fn with_clock(main: B, reserve: Option<B>, state: Arc<DownState>, clock: Arc<dyn Clock>) -> Self {
        FailoverApi { main: Arc::new(main), reserve: reserve.map(Arc::new), state, clock }
    }

    fn via_reserve(&self, reserve: &B, req: &Request, timeout: Duration) -> Result<Value, ApiError> {
        reserve.check_within(req, timeout).map(mark_reserve)
    }

    /// Background probe of the main server: at most once a minute, never delays a check.
    fn maybe_probe(&self, now: Duration) {
        {
            let mut g = self.state.0.lock().unwrap();
            match g.as_mut() {
                Some(d) if !d.probing && d.probe_at.map_or(true, |t| now >= t + PROBE_EVERY) => {
                    d.probing = true;
                    d.probe_at = Some(now);
                }
                _ => return,
            }
        }
        let (main, state) = (self.main.clone(), self.state.clone());
        std::thread::spawn(move || {
            let ok = main.healthy();
            let mut g = state.0.lock().unwrap();
            if ok {
                *g = None;
            } else if let Some(d) = g.as_mut() {
                d.probing = false;
            }
        });
    }
}

/// An answer from the reserve carries `"via": "reserve"`.
fn mark_reserve(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.insert("via".into(), Value::String("reserve".into()));
    }
    v
}

impl<B: Backend + Send + Sync + 'static> CheckApi for FailoverApi<B> {
    fn check(&self, req: &Request) -> Result<Value, ApiError> {
        let Some(reserve) = self.reserve.as_deref() else {
            return self.main.check_within(req, RESERVE_TIMEOUT);
        };
        let start = self.clock.now();
        let left = |c: &dyn Clock| TOTAL_BUDGET.saturating_sub(c.now().saturating_sub(start));
        let down = self.state.0.lock().unwrap().clone().filter(|d| d.until > start);

        if let Some(d) = down {
            self.maybe_probe(start);
            match self.via_reserve(reserve, req, RESERVE_TIMEOUT.min(left(&*self.clock))) {
                Ok(v) => return Ok(v),
                Err(e) if !e.failover_worthy() => return Err(e),
                Err(_) => {}
            }
            let l = left(&*self.clock);
            if l >= MIN_LEFT {
                let r = self.main.check_within(req, l);
                if r.is_ok() {
                    self.state.clear();
                }
                return r;
            }
            return Err(d.error);
        }

        match self.main.check_within(req, PRIMARY_TIMEOUT) {
            Ok(v) => {
                if self.state.0.lock().unwrap().is_some() {
                    self.state.clear();
                }
                Ok(v)
            }
            Err(e) if !e.failover_worthy() => Err(e),
            Err(e) => {
                *self.state.0.lock().unwrap() = Some(Down { until: start + DOWN_FOR, probe_at: None, error: e.clone(), probing: false });
                let l = RESERVE_TIMEOUT.min(left(&*self.clock));
                if l < MIN_LEFT {
                    return Err(e);
                }
                // Both failed: the reason of the main server.
                self.via_reserve(reserve, req, l).map_err(|_| e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct FakeClock(AtomicU64);
    impl FakeClock {
        fn advance(&self, ms: u64) {
            self.0.fetch_add(ms, Ordering::SeqCst);
        }
    }
    impl Clock for FakeClock {
        fn now(&self) -> Duration {
            Duration::from_millis(self.0.load(Ordering::SeqCst))
        }
    }

    /// Scripted server: each call takes `cost` ms of fake time and answers with the next scripted result.
    struct Fake {
        name: &'static str,
        clock: Arc<FakeClock>,
        script: Mutex<VecDeque<(u64, Result<Value, ApiError>)>>,
        calls: Arc<Mutex<Vec<(&'static str, Duration)>>>,
        healthy: Arc<Mutex<bool>>,
        probes: Arc<AtomicU64>,
    }

    impl Backend for Fake {
        fn check_within(&self, _req: &Request, timeout: Duration) -> Result<Value, ApiError> {
            self.calls.lock().unwrap().push((self.name, timeout));
            let (cost, r) = self.script.lock().unwrap().pop_front().expect("unexpected call");
            self.clock.advance(cost);
            r
        }
        fn healthy(&self) -> bool {
            self.probes.fetch_add(1, Ordering::SeqCst);
            *self.healthy.lock().unwrap()
        }
    }

    struct World {
        api: FailoverApi<Fake>,
        clock: Arc<FakeClock>,
        state: Arc<DownState>,
        calls: Arc<Mutex<Vec<(&'static str, Duration)>>>,
        healthy: Arc<Mutex<bool>>,
        probes: Arc<AtomicU64>,
    }

    fn answer() -> Value {
        json!({"api":1,"stufe":"gruen","findings":[]})
    }
    fn world(main: Vec<(u64, Result<Value, ApiError>)>, reserve: Vec<(u64, Result<Value, ApiError>)>, with_reserve: bool) -> World {
        let clock = Arc::new(FakeClock(AtomicU64::new(1_000_000)));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let healthy = Arc::new(Mutex::new(true));
        let probes = Arc::new(AtomicU64::new(0));
        let mk = |name, s: Vec<_>| Fake { name, clock: clock.clone(), script: Mutex::new(s.into()), calls: calls.clone(), healthy: healthy.clone(), probes: probes.clone() };
        let state = DownState::new();
        let api = FailoverApi::with_clock(mk("main", main), with_reserve.then(|| mk("reserve", reserve)), state.clone(), clock.clone());
        World { api, clock, state, calls, healthy, probes }
    }
    fn req() -> Request {
        Request { url: "https://a.example/".into(), lang: "en".into(), scope: "url".into() }
    }
    fn names(w: &World) -> Vec<&'static str> {
        w.calls.lock().unwrap().iter().map(|c| c.0).collect()
    }
    fn wait_for(f: impl Fn() -> bool) {
        for _ in 0..200 {
            if f() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("condition not reached");
    }

    #[test]
    fn main_up_no_reserve_call() {
        let w = world(vec![(100, Ok(answer()))], vec![], true);
        let v = w.api.check(&req()).unwrap();
        assert!(v.get("via").is_none());
        assert_eq!(names(&w), ["main"]);
        assert_eq!(w.calls.lock().unwrap()[0].1, PRIMARY_TIMEOUT);
        assert!(!w.state.is_down(w.clock.now()));
    }

    #[test]
    fn main_down_reserve_answers_with_via_and_is_remembered() {
        let w = world(vec![(4500, Err(ApiError::Timeout))], vec![(300, Ok(answer()))], true);
        let v = w.api.check(&req()).unwrap();
        assert_eq!(v["via"], "reserve");
        assert_eq!(v["stufe"], "gruen");
        assert_eq!(names(&w), ["main", "reserve"]);
        assert!(w.state.is_down(w.clock.now()));
    }

    #[test]
    fn failover_worthy_classification() {
        for e in [ApiError::Timeout, ApiError::Network("x".into()), ApiError::Status(500, "x".into()), ApiError::Status(503, String::new()), ApiError::BadBody(502), ApiError::BadBody(403), ApiError::BadResponse("x".into())] {
            assert!(e.failover_worthy(), "{e:?}");
            let w = world(vec![(10, Err(e.clone()))], vec![(10, Ok(answer()))], true);
            assert_eq!(w.api.check(&req()).unwrap()["via"], "reserve", "{e:?}");
        }
        for e in [ApiError::NoServer, ApiError::Status(400, "err.nolink".into()), ApiError::Status(400, "err.install".into()), ApiError::Status(413, "x".into()), ApiError::Status(415, "x".into()), ApiError::Status(403, "forbidden".into()), ApiError::Status(429, "err.rate".into())] {
            assert!(!e.failover_worthy(), "{e:?}");
            let w = world(vec![(10, Err(e.clone()))], vec![], true);
            assert_eq!(w.api.check(&req()).unwrap_err(), e);
            assert_eq!(names(&w), ["main"], "{e:?} must not reach the reserve");
            assert!(!w.state.is_down(w.clock.now()));
        }
    }

    #[test]
    fn both_down_reports_the_main_reason_within_eight_seconds() {
        let w = world(vec![(4500, Err(ApiError::Status(502, "x".into())))], vec![(3500, Err(ApiError::Timeout))], true);
        let t0 = w.clock.now();
        let e = w.api.check(&req()).unwrap_err();
        assert_eq!(e, ApiError::Status(502, "x".into()));
        assert!(w.clock.now() - t0 <= TOTAL_BUDGET);
        assert_eq!(w.calls.lock().unwrap()[1].1, Duration::from_millis(3500), "reserve gets min(6 s, 8 s - elapsed)");
    }

    #[test]
    fn reserve_skipped_when_less_than_1500_ms_remain() {
        let w = world(vec![(7000, Err(ApiError::Timeout))], vec![], true);
        assert_eq!(w.api.check(&req()).unwrap_err(), ApiError::Timeout);
        assert_eq!(names(&w), ["main"]);
        assert!(w.state.is_down(w.clock.now()));
    }

    #[test]
    fn marked_down_goes_straight_to_the_reserve() {
        let w = world(vec![(4500, Err(ApiError::Network("x".into())))], vec![(100, Ok(answer())), (100, Ok(answer()))], true);
        w.api.check(&req()).unwrap();
        w.calls.lock().unwrap().clear();
        w.clock.advance(10_000);
        let v = w.api.check(&req()).unwrap();
        assert_eq!(v["via"], "reserve");
        assert_eq!(names(&w), ["reserve"]);
        assert_eq!(w.calls.lock().unwrap()[0].1, RESERVE_TIMEOUT);
    }

    #[test]
    fn down_and_reserve_fails_too_main_gets_what_is_left() {
        let w = world(vec![(4500, Err(ApiError::Timeout)), (100, Ok(answer()))], vec![(0, Ok(answer())), (4000, Err(ApiError::Timeout))], true);
        w.api.check(&req()).unwrap();
        *w.healthy.lock().unwrap() = false;
        w.calls.lock().unwrap().clear();
        let v = w.api.check(&req()).unwrap();
        assert!(v.get("via").is_none(), "main answered");
        assert_eq!(names(&w), ["reserve", "main"]);
        assert_eq!(w.calls.lock().unwrap()[1].1, Duration::from_millis(4000));
        assert!(!w.state.is_down(w.clock.now()), "a successful main answer clears the mark");
    }

    #[test]
    fn down_and_reserve_fails_with_no_time_left_reports_the_remembered_reason() {
        let w = world(vec![(4500, Err(ApiError::Status(500, "x".into())))], vec![(10, Ok(answer())), (6900, Err(ApiError::Timeout))], true);
        w.api.check(&req()).unwrap();
        w.clock.advance(1000);
        assert_eq!(w.api.check(&req()).unwrap_err(), ApiError::Status(500, "x".into()));
        assert_eq!(names(&w), ["main", "reserve", "reserve"]);
    }

    #[test]
    fn health_probe_ok_switches_back_at_once_and_runs_at_most_once_a_minute() {
        let w = world(vec![(4500, Err(ApiError::Timeout)), (100, Ok(answer()))], vec![(100, Ok(answer())), (100, Ok(answer())), (100, Ok(answer())), (100, Ok(answer()))], true);
        *w.healthy.lock().unwrap() = false;
        w.api.check(&req()).unwrap();
        w.api.check(&req()).unwrap(); // probe 1 (fails)
        wait_for(|| w.probes.load(Ordering::SeqCst) == 1);
        wait_for(|| !w.state.0.lock().unwrap().as_ref().unwrap().probing);
        w.clock.advance(30_000);
        w.api.check(&req()).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(w.probes.load(Ordering::SeqCst), 1, "not within 60 s");
        assert!(w.state.is_down(w.clock.now()));
        w.clock.advance(31_000);
        *w.healthy.lock().unwrap() = true;
        w.api.check(&req()).unwrap(); // probe 2 (ok)
        wait_for(|| w.probes.load(Ordering::SeqCst) == 2);
        wait_for(|| !w.state.is_down(w.clock.now()));
        assert!(names(&w).iter().filter(|n| **n == "main").count() == 1, "the probe is not a check");
        assert_eq!(w.api.check(&req()).unwrap().get("via"), None);
        assert_eq!(names(&w).last(), Some(&"main"));
    }

    #[test]
    fn after_five_minutes_main_is_tried_first_again() {
        let w = world(vec![(4500, Err(ApiError::Timeout)), (100, Ok(answer()))], vec![(100, Ok(answer()))], true);
        *w.healthy.lock().unwrap() = false;
        w.api.check(&req()).unwrap();
        w.clock.advance(DOWN_FOR.as_millis() as u64 + 1);
        assert!(!w.state.is_down(w.clock.now()));
        let v = w.api.check(&req()).unwrap();
        assert!(v.get("via").is_none());
        assert_eq!(names(&w), ["main", "reserve", "main"]);
        assert!(!w.state.is_down(w.clock.now()));
    }

    #[test]
    fn without_a_reserve_the_main_server_is_asked_once_and_nothing_is_remembered() {
        let w = world(vec![(10, Err(ApiError::Timeout))], vec![], false);
        assert_eq!(w.api.check(&req()).unwrap_err(), ApiError::Timeout);
        assert_eq!(names(&w), ["main"]);
        assert!(!w.state.is_down(w.clock.now()));
    }

    #[test]
    fn reserve_only_for_the_built_in_address() {
        let p = "https://lw.example";
        let r = "https://reserve.workers.example";
        assert_eq!(reserve_for("https://lw.example/", p, r).as_deref(), Some(r));
        assert_eq!(reserve_for("https://own.example", p, r), None, "own address: no foreign reserve");
        assert_eq!(reserve_for(p, p, ""), None);
        assert_eq!(reserve_for(p, p, p), None);
        assert_eq!(reserve_for(p, p, "http://reserve.example"), None);
        assert_eq!(reserve_for(p, "", r), None);
        assert_eq!(reserve_for("", "", r), None);
    }
}
