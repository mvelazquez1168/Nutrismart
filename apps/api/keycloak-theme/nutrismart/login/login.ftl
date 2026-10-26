<#--
  Pantalla de acceso de NutriSmart — R54.

  Replica el diseño de `apps/web-professional/src/pages/Login.tsx`: panel
  de color a la izquierda, formulario a la derecha. Así el usuario pulsa
  «Iniciar sesión» y la pantalla a la que llega es visualmente la misma;
  el salto a un dominio distinto deja de notarse.

  Lo que NO cambia respecto a antes: las contraseñas las sigue viendo
  SOLO Keycloak. Este formulario hace POST a `url.loginAction`, que es
  suyo. La aplicación no las toca, y el flujo de código de autorización
  con PKCE se queda intacto.

  Se descartaron las otras dos vías: un formulario propio en la app que
  mandara las credenciales por API (Direct Access Grants) convertiría a
  la aplicación en un sitio que ve las contraseñas de todo el mundo, y
  un iframe no funciona en Safari, que bloquea las cookies de terceros.
-->
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password'); section>

<#if section = "header">
<#-- Vacío a propósito: la cabecera del tema base no se usa, la
     identidad va dentro del cuerpo. -->

<#elseif section = "form">
<div class="ns-split">

  <div class="ns-panel" aria-hidden="true">
    <div class="ns-panel-contenido">
      <span class="ns-marca-blanca">NutriSmart</span>
      <p class="ns-lema">Gestión nutricional</p>
    </div>
  </div>

  <div class="ns-formulario">
    <div class="ns-card">
      <div class="ns-marca">
        <span class="ns-marca-texto">NutriSmart</span>
        <span class="ns-marca-pie">Gestión clínica</span>
      </div>

      <form id="kc-form-login" action="${url.loginAction}" method="post">
        <div class="ns-campo">
          <label for="username" class="ns-etiqueta">${msg("usernameOrEmail")}</label>
          <#--
            type="text" y no type="email".

            Los profesionales entran con su correo, pero las cuentas de
            paciente no tienen por qué: en este realm hay usuarios como
            `paciente-prueba`. Con type="email" el navegador bloquea el
            envío y enseña «incluye una @», que no hay forma de entender
            cuando tu usuario simplemente no es un correo.
          -->
          <input
            tabindex="1"
            id="username"
            name="username"
            class="ns-input"
            type="text"
            value="${(login.username!'')}"
            autofocus
            autocomplete="username"
            aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
          />
        </div>

        <div class="ns-campo">
          <label for="password" class="ns-etiqueta">${msg("password")}</label>
          <input
            tabindex="2"
            id="password"
            name="password"
            class="ns-input"
            type="password"
            autocomplete="current-password"
            aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
          />
        </div>

        <#if messagesPerField.existsError('username','password')>
          <div class="ns-error" role="alert">
            ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
          </div>
        </#if>

        <#if realm.resetPasswordAllowed>
          <div class="ns-olvide">
            <a href="${url.loginResetCredentialsUrl}">¿Olvidaste tu contraseña?</a>
          </div>
        </#if>

        <#-- Keycloak necesita este campo para recordar qué credencial se
             usó cuando el usuario tiene más de una. -->
        <input type="hidden" id="id-hidden-input" name="credentialId"
               <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if> />

        <input tabindex="3" class="ns-boton" name="login" id="kc-login"
               type="submit" value="${msg("doLogIn")}" />
      </form>

      <#-- Quien no tiene cuenta no puede crearla: las da el
           administrador de la clínica (GAM-02). Decirlo evita que
           alguien busque un enlace de registro que no existe. -->
      <p class="ns-pie">¿No tienes cuenta? Pídesela al administrador de tu clínica.</p>
    </div>
  </div>

</div>
</#if>

</@layout.registrationLayout>
