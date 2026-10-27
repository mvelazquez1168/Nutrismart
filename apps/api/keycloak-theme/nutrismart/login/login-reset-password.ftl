<#--
  Recuperar la contraseña — NutriSmart.

  Existe porque el enlace «¿Olvidaste tu contraseña?» tiene que llevar a
  algún sitio que se parezca al login. La plantilla que trae Keycloak
  usa su propio marcado (`.card-pf`, `#kc-content`), y el CSS de este
  tema le quita a ese marcado el fondo, el borde y el ancho máximo para
  poder pintar el panel partido. Resultado sin este archivo: un campo de
  texto de borde a borde de la pantalla, un botón azul de PatternFly y
  ni rastro de la marca.

  Reutiliza el mismo esqueleto que `login.ftl` —mismas clases `ns-*`, el
  mismo panel de color— para que pasar de una pantalla a la otra no se
  note.

  El flujo sigue siendo el NATIVO: este formulario hace POST a
  `url.loginAction`, Keycloak manda el correo con un enlace de un solo
  uso y la aplicación no participa en ningún momento.
-->
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username'); section>

<#if section = "header">
<#-- Vacío: el título va dentro de la tarjeta, como en login.ftl. -->

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
        <span class="ns-marca-pie">${msg("emailForgotTitle")}</span>
      </div>

      <p class="ns-instruccion">${msg("emailInstruction")}</p>

      <form id="kc-reset-password-form" action="${url.loginAction}" method="post">
        <div class="ns-campo">
          <label for="username" class="ns-etiqueta">${msg("usernameOrEmail")}</label>
          <#--
            `auth.attemptedUsername` rellena el campo con lo que la
            persona ya escribió en el login. Si llegó aquí es porque su
            contraseña falló: volver a teclear el usuario es trabajo que
            ya hizo.
          -->
          <input
            tabindex="1"
            id="username"
            name="username"
            class="ns-input"
            type="text"
            value="${(auth.attemptedUsername!'')}"
            autofocus
            autocomplete="username"
            aria-invalid="<#if messagesPerField.existsError('username')>true</#if>"
          />
        </div>

        <#if messagesPerField.existsError('username')>
          <div class="ns-error" role="alert">
            ${kcSanitize(messagesPerField.get('username'))?no_esc}
          </div>
        </#if>

        <input tabindex="2" class="ns-boton" type="submit" value="${msg("nsEnviarInstrucciones")}" />

        <div class="ns-olvide">
          <a href="${url.loginUrl}" tabindex="3">${kcSanitize(msg("backToLogin"))?no_esc}</a>
        </div>
      </form>
    </div>
  </div>

</div>
</#if>

</@layout.registrationLayout>
