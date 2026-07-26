// Circular (clock-face) time picker, registered as an Alpine.js component.
// Usage: x-data="timeDial('start_time_str', '09:00')" — fieldName becomes the
// hidden <input> name submitted with the form; initial is an "HH:MM" 24h string.
document.addEventListener('alpine:init', () => {
  Alpine.data('timeDial', (fieldName, initial) => ({
    fieldName,
    open: false,
    mode: 'hour', // 'hour' | 'minute'
    dragging: false,
    hours24: 9,
    minutes: 0,
    savedHours24: 9,
    savedMinutes: 0,
    hourPoints: [],
    minutePoints: [],
    minuteTicks: [],

    init() {
      const m = /^(\d{1,2}):(\d{2})$/.exec(initial || '');
      this.hours24 = m ? Math.min(23, parseInt(m[1], 10)) : 9;
      this.minutes = m ? Math.min(59, parseInt(m[2], 10)) : 0;

      this.hourPoints = Array.from({ length: 12 }, (_, i) => {
        const h = i === 0 ? 12 : i;
        return { value: h, label: String(h), ...this.pointOnCircle(this.angleForHour(h), 74) };
      });
      this.minutePoints = Array.from({ length: 12 }, (_, i) => {
        const mm = i * 5;
        return { value: mm, label: String(mm).padStart(2, '0'), ...this.pointOnCircle(this.angleForMinute(mm), 74) };
      });
      this.minuteTicks = Array.from({ length: 60 }, (_, mm) => this.pointOnCircle(this.angleForMinute(mm), 90));
      this.$nextTick(() => this.syncFields());
      this.$watch('value', (val) => this.$dispatch('time-changed', { field: this.fieldName, value: val }));
      this.$dispatch('time-changed', { field: this.fieldName, value: this.value });
    },

    // Hour/minute <input>s are uncontrolled (no :value binding) so a reactive
    // re-render never clobbers what's mid-typed; call this to push hours24/minutes
    // into them after a change that didn't originate from typing in them directly
    // (dial drag/tap, init, cancel).
    syncFields() {
      if (this.$refs.hourInput) this.$refs.hourInput.value = this.hour12;
      if (this.$refs.minuteInput) this.$refs.minuteInput.value = String(this.minutes).padStart(2, '0');
    },

    angleForHour(h) { return ((h % 12) / 12) * 2 * Math.PI; },
    angleForMinute(mm) { return (mm / 60) * 2 * Math.PI; },
    pointOnCircle(angleRad, radius) {
      return { x: 100 + radius * Math.sin(angleRad), y: 100 - radius * Math.cos(angleRad) };
    },

    get hour12() {
      const h = this.hours24 % 12;
      return h === 0 ? 12 : h;
    },
    get isPM() { return this.hours24 >= 12; },
    get value() {
      return String(this.hours24).padStart(2, '0') + ':' + String(this.minutes).padStart(2, '0');
    },
    get display() {
      return this.hour12 + ':' + String(this.minutes).padStart(2, '0') + ' ' + (this.isPM ? 'PM' : 'AM');
    },
    get handPoint() {
      return this.mode === 'hour'
        ? this.pointOnCircle(this.angleForHour(this.hour12), 74)
        : this.pointOnCircle(this.angleForMinute(this.minutes), 74);
    },

    setHour12(h) { this.hours24 = (h % 12) + (this.isPM ? 12 : 0); },
    setPM(pm) { this.hours24 = (this.hour12 % 12) + (pm ? 12 : 0); },
    selectHour(h) { this.setHour12(h); this.mode = 'minute'; this.syncFields(); },
    selectMinute(mm) { this.minutes = mm; this.syncFields(); },
    bumpHour(delta) { this.setHour12((((this.hour12 - 1 + delta) % 12) + 12) % 12 + 1); },
    bumpMinute(delta) { this.minutes = ((this.minutes + delta) % 60 + 60) % 60; },

    onHourTyped(e) {
      const h = parseInt(e.target.value, 10);
      if (!isNaN(h)) this.setHour12(Math.max(1, Math.min(12, h)));
      if (e.target.value.length >= 2 && this.$refs.minuteInput) {
        this.$refs.minuteInput.focus();
        this.$refs.minuteInput.select();
      }
    },
    onMinuteTyped(e) {
      const mm = parseInt(e.target.value, 10);
      if (!isNaN(mm)) this.minutes = Math.max(0, Math.min(59, mm));
    },
    onFieldBlur() { this.syncFields(); },

    openPicker() {
      this.savedHours24 = this.hours24;
      this.savedMinutes = this.minutes;
      this.mode = 'hour';
      this.open = true;
      this.syncFields();
      this.$nextTick(() => this.$refs.dial && this.$refs.dial.focus());
    },
    cancel() {
      this.hours24 = this.savedHours24;
      this.minutes = this.savedMinutes;
      this.syncFields();
      this.open = false;
    },
    confirm() { this.open = false; },

    pointerAngle(evt) {
      const rect = this.$refs.dial.getBoundingClientRect();
      const x = evt.clientX - (rect.left + rect.width / 2);
      const y = evt.clientY - (rect.top + rect.height / 2);
      let angle = Math.atan2(x, -y);
      if (angle < 0) angle += 2 * Math.PI;
      return angle;
    },
    updateFromAngle(angle) {
      const deg = angle * 180 / Math.PI;
      if (this.mode === 'hour') {
        let h = Math.round(deg / 30) % 12;
        this.setHour12(h === 0 ? 12 : h);
      } else {
        this.minutes = Math.round(deg / 6) % 60;
      }
      this.syncFields();
    },
    startDrag(evt) {
      this.dragging = true;
      this.$refs.dial.setPointerCapture(evt.pointerId);
      this.updateFromAngle(this.pointerAngle(evt));
    },
    drag(evt) {
      if (!this.dragging) return;
      this.updateFromAngle(this.pointerAngle(evt));
    },
    endDrag(evt) {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.$refs.dial.hasPointerCapture(evt.pointerId)) {
        this.$refs.dial.releasePointerCapture(evt.pointerId);
      }
      if (this.mode === 'hour') this.mode = 'minute';
    },
  }));
});
