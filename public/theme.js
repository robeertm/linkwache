// Tagmodus: gespeicherte Wahl vor dem ersten Zeichnen anwenden, Knopf im Kopf schaltet um.
(function(){
  var k="lw-theme", t=null; try{ t=localStorage.getItem(k); }catch(e){}
  if(t==="light"||t==="dark") document.documentElement.setAttribute("data-theme",t);
  function ist(){ var a=document.documentElement.getAttribute("data-theme"); if(a) return a; return matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"; }
  function mal(b){ b.textContent = ist()==="dark" ? "☀️" : "🌙"; b.setAttribute("aria-label", ist()==="dark" ? "Tagmodus" : "Nachtmodus"); }
  document.addEventListener("DOMContentLoaded", function(){
    var b=document.getElementById("theme"); if(!b) return; mal(b);
    b.addEventListener("click", function(){ var n = ist()==="dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", n); try{ localStorage.setItem(k,n); }catch(e){} mal(b); });
  });
})();
